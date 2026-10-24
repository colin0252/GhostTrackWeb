
import os
import re
import time
from collections import defaultdict
from typing import Optional
from urllib.parse import quote

import phonenumbers
import requests
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from phonenumbers import carrier, geocoder, timezone
from pydantic import BaseModel, validator

app = FastAPI(
    title="GhostTrack API",
    description="OSINT公开信息查询 API",
    version="2.2.0"
)

# -------------------------
# 请求频率限制
# -------------------------

class RateLimiter:
    def __init__(self):
        self.requests = defaultdict(list)
        self.max_requests = 10
        self.window = 60

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        self.requests[client_ip] = [
            item for item in self.requests[client_ip]
            if now - item < self.window
        ]

        if len(self.requests[client_ip]) >= self.max_requests:
            return False

        self.requests[client_ip].append(now)
        return True


rate_limiter = RateLimiter()


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path in ["/", "/health"]:
        return await call_next(request)

    client_ip = request.client.host if request.client else "unknown"

    if not rate_limiter.is_allowed(client_ip):
        return JSONResponse(
            status_code=429,
            content={"detail": "请求过于频繁，请稍后再试。"}
        )

    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://ghosttrackweb.onrender.com"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------
# 数据模型
# -------------------------

class IPTrackRequest(BaseModel):
    ip_address: str

    @validator("ip_address")
    def validate_ip(cls, value):
        value = value.strip()

        if not value:
            raise ValueError("IP 地址不能为空")

        pattern = re.compile(
            r"^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}"
            r"(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
        )

        if not pattern.match(value):
            raise ValueError("无效的 IPv4 地址")

        parts = [int(part) for part in value.split(".")]
        first, second = parts[0], parts[1]

        if (
            first == 10
            or (first == 172 and 16 <= second <= 31)
            or (first == 192 and second == 168)
            or first == 127
            or first == 0
            or first >= 224
        ):
            raise ValueError("不支持查询私有、内网或特殊 IP 地址")

        return value


class PhoneTrackRequest(BaseModel):
    phone_number: str

    @validator("phone_number")
    def validate_phone(cls, value):
        value = value.strip()

        if not value:
            raise ValueError("手机号码不能为空")

        if len(value) > 20:
            raise ValueError("手机号码过长")

        if not re.match(r"^\+[1-9]\d{1,14}$", value):
            raise ValueError(
                "请使用国际号码格式，例如 +8613800138000"
            )

        return value


class UsernameTrackRequest(BaseModel):
    username: str

    @validator("username")
    def validate_username(cls, value):
        value = value.strip()

        if not value:
            raise ValueError("用户名不能为空")

        if len(value) > 50:
            raise ValueError("用户名过长")

        if not re.match(r"^[a-zA-Z0-9._-]+$", value):
            raise ValueError(
                "用户名只能包含字母、数字、下划线、连字符和点"
            )

        return value


# -------------------------
# 中文元数据
# -------------------------

COUNTRY_NAMES = {
    "CN": "中国",
    "US": "美国",
    "ID": "印度尼西亚",
    "SG": "新加坡",
    "GB": "英国",
    "CA": "加拿大",
    "AU": "澳大利亚",
    "JP": "日本",
    "KR": "韩国",
    "IN": "印度",
    "MY": "马来西亚",
    "TH": "泰国",
    "VN": "越南",
    "PH": "菲律宾",
    "DE": "德国",
    "FR": "法国",
    "RU": "俄罗斯",
    "BR": "巴西",
    "IT": "意大利",
    "ES": "西班牙",
    "HK": "中国香港",
    "MO": "中国澳门",
    "TW": "中国台湾",
    "NZ": "新西兰",
    "CH": "瑞士",
    "NL": "荷兰",
    "SE": "瑞典",
    "NO": "挪威",
    "IE": "爱尔兰",
    "AE": "阿联酋",
    "SA": "沙特阿拉伯",
    "ZA": "南非",
    "MX": "墨西哥",
    "AR": "阿根廷",
    "TR": "土耳其"
}

CARRIER_NAMES = {
    "China Telecom": "中国电信",
    "China Mobile": "中国移动",
    "China Unicom": "中国联通",
    "China Tietong": "中国铁通",
    "China Broadnet": "中国广电"
}

NUMBER_TYPE_NAMES = {
    phonenumbers.PhoneNumberType.FIXED_LINE: "固定电话",
    phonenumbers.PhoneNumberType.MOBILE: "移动电话",
    phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE: "固定电话或移动电话",
    phonenumbers.PhoneNumberType.TOLL_FREE: "免费电话",
    phonenumbers.PhoneNumberType.PREMIUM_RATE: "高资费电话",
    phonenumbers.PhoneNumberType.SHARED_COST: "分摊费用电话",
    phonenumbers.PhoneNumberType.VOIP: "网络电话",
    phonenumbers.PhoneNumberType.PERSONAL_NUMBER: "个人号码",
    phonenumbers.PhoneNumberType.PAGER: "寻呼号码",
    phonenumbers.PhoneNumberType.UAN: "统一接入号码",
    phonenumbers.PhoneNumberType.VOICEMAIL: "语音信箱号码",
    phonenumbers.PhoneNumberType.UNKNOWN: "未知类型"
}


# -------------------------
# Serper 公开网页搜索
# -------------------------

def search_public_web(phone_number: str) -> dict:
    """
    使用 Serper 搜索公开网页。
    API 密钥从 Render 环境变量 SERPER_API_KEY 读取。
    不返回密钥，也不把密钥写入日志或响应。
    """
    api_key = os.getenv("SERPER_API_KEY", "").strip()

    if not api_key:
        return {
            "status": "not_configured",
            "message": "尚未配置公开网页搜索 API。",
            "total_results": 0,
            "results": []
        }

    query = (
        f'"{phone_number}" '
        '(诈骗 OR 骚扰电话 OR 企业 OR 联系方式)'
    )

    try:
        response = requests.post(
            "https://google.serper.dev/search",
            headers={
                "X-API-KEY": api_key,
                "Content-Type": "application/json"
            },
            json={
                "q": query,
                "num": 10
            },
            timeout=15
        )

        if response.status_code == 401:
            return {
                "status": "authentication_error",
                "message": "搜索服务认证失败，请检查 Render 中的 API 密钥。",
                "total_results": 0,
                "results": []
            }

        if response.status_code == 403:
            return {
                "status": "access_denied",
                "message": "搜索服务拒绝请求，请检查 API 权限或额度。",
                "total_results": 0,
                "results": []
            }

        if response.status_code == 429:
            return {
                "status": "quota_or_rate_limit",
                "message": "搜索请求达到服务限制，请稍后重试或检查剩余额度。",
                "total_results": 0,
                "results": []
            }

        response.raise_for_status()
        data = response.json()

        results = []

        for item in data.get("organic", []):
            link = item.get("link")
            title = item.get("title")
            snippet = item.get("snippet")

            if not link or not title:
                continue

            if not link.startswith(("https://", "http://")):
                continue

            results.append({
                "title": title,
                "url": link,
                "snippet": snippet or "",
                "date": item.get("date"),
                "source": item.get("source") or "",
                "position": item.get("position"),
                "status": "待人工核实",
                "confidence": "搜索发现，尚未独立验证"
            })

        if not results:
            return {
                "status": "no_results",
                "message": "本次搜索没有返回公开网页结果。",
                "total_results": 0,
                "results": []
            }

        return {
            "status": "success",
            "message": "已获取公开网页搜索结果，请核对原始网页。",
            "total_results": len(results),
            "results": results
        }

    except requests.Timeout:
        return {
            "status": "timeout",
            "message": "公开网页搜索超时，请稍后重试。",
            "total_results": 0,
            "results": []
        }

    except requests.RequestException:
        return {
            "status": "service_error",
            "message": "公开网页搜索服务暂时不可用。",
            "total_results": 0,
            "results": []
        }

    except (ValueError, TypeError):
        return {
            "status": "invalid_response",
            "message": "搜索服务返回的数据无法读取。",
            "total_results": 0,
            "results": []
        }


# -------------------------
# 基础接口
# -------------------------

@app.get("/")
async def root():
    return {
        "message": "GhostTrack API",
        "status": "running",
        "version": "2.2.0"
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "version": "2.2.0"
    }


# -------------------------
# 获取服务器公网 IP
# -------------------------

@app.get("/api/my-ip")
async def get_my_ip():
    try:
        response = requests.get(
            "https://api.ipify.org/",
            timeout=10
        )
        response.raise_for_status()

        return {
            "ip": response.text.strip(),
            "success": True
        }

    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail="无法获取公网 IP，请稍后重试"
        )


# -------------------------
# IP 查询
# -------------------------

@app.post("/api/track-ip")
async def track_ip(request: IPTrackRequest):
    try:
        response = requests.get(
            f"https://ipwho.is/{request.ip_address}",
            timeout=15
        )
        response.raise_for_status()
        data = response.json()

        if not data.get("success", False):
            raise HTTPException(
                status_code=400,
                detail="IP 查询服务未能确认该地址"
            )

        latitude = data.get("latitude")
        longitude = data.get("longitude")

        maps_url = None
        if latitude is not None and longitude is not None:
            maps_url = (
                f"https://www.google.com/maps/@"
                f"{latitude},{longitude},8z"
            )

        return {
            "ip": request.ip_address,
            "type": data.get("type"),
            "country": data.get("country"),
            "country_code": data.get("country_code"),
            "city": data.get("city"),
            "continent": data.get("continent"),
            "continent_code": data.get("continent_code"),
            "region": data.get("region"),
            "region_code": data.get("region_code"),
            "latitude": latitude,
            "longitude": longitude,
            "maps_url": maps_url,
            "is_eu": data.get("is_eu"),
            "postal": data.get("postal"),
            "calling_code": data.get("calling_code"),
            "capital": data.get("capital"),
            "borders": data.get("borders"),
            "flag": (data.get("flag") or {}).get("emoji"),
            "connection": {
                "asn": (data.get("connection") or {}).get("asn"),
                "org": (data.get("connection") or {}).get("org"),
                "isp": (data.get("connection") or {}).get("isp"),
                "domain": (data.get("connection") or {}).get("domain")
            },
            "timezone": data.get("timezone"),
            "source": {
                "name": "ipwho.is",
                "url": "https://ipwho.is/",
                "confidence": "参考性",
                "note": "IP 地理位置通常是估算位置，不代表设备的精确 GPS 位置。"
            },
            "success": True
        }

    except HTTPException:
        raise
    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail="IP 查询服务暂时不可用"
        )


# -------------------------
# 手机号码 OSINT 查询
# -------------------------

@app.post("/api/track-phone")
async def track_phone(request: PhoneTrackRequest):
    try:
        parsed = phonenumbers.parse(request.phone_number, None)

        region_code = phonenumbers.region_code_for_number(parsed)
        is_possible = phonenumbers.is_possible_number(parsed)
        is_valid = phonenumbers.is_valid_number(parsed)

        number_type = phonenumbers.number_type(parsed)
        type_description = NUMBER_TYPE_NAMES.get(
            number_type,
            "未知类型"
        )

        carrier_original = carrier.name_for_number(parsed, "en") or None

        carrier_display = (
            CARRIER_NAMES.get(carrier_original, carrier_original)
            if carrier_original
            else None
        )

        location_zh = (
            geocoder.description_for_number(parsed, "zh")
            or geocoder.description_for_number(parsed, "en")
            or None
        )

        timezones = timezone.time_zones_for_number(parsed)
        timezone_list = list(timezones) if timezones else []

        international_format = phonenumbers.format_number(
            parsed,
            phonenumbers.PhoneNumberFormat.INTERNATIONAL
        )

        e164_format = phonenumbers.format_number(
            parsed,
            phonenumbers.PhoneNumberFormat.E164
        )

        national_format = phonenumbers.format_number(
            parsed,
            phonenumbers.PhoneNumberFormat.NATIONAL
        )

        country_name = COUNTRY_NAMES.get(
            region_code,
            region_code or "未知"
        )

        # 保留原有搜索入口，方便用户手动交叉核实。
        quoted_phone = quote(f'"{e164_format}"')
        fraud_terms = quote(
            '"诈骗" OR "骚扰电话" OR "垃圾电话" OR "反诈"'
        )
        business_terms = quote(
            '"企业" OR "联系方式" OR "公开电话"'
        )

        public_search = [
            {
                "name": "Bing 公开网页搜索",
                "url": (
                    "https://www.bing.com/search?q="
                    f"{quoted_phone}+({fraud_terms})"
                ),
                "purpose": "查找公开网页中的诈骗或骚扰相关线索",
                "status": "待人工核实",
                "confidence": "未经核实"
            },
            {
                "name": "Google 公开网页搜索",
                "url": (
                    "https://www.google.com/search?q="
                    f"{quoted_phone}+({fraud_terms})"
                ),
                "purpose": "交叉检查公开网页线索",
                "status": "待人工核实",
                "confidence": "未经核实"
            },
            {
                "name": "Bing 企业公开信息搜索",
                "url": (
                    "https://www.bing.com/search?q="
                    f"{quoted_phone}+({business_terms})"
                ),
                "purpose": "查找可能公开发布该号码的企业网页",
                "status": "待人工核实",
                "confidence": "未经核实"
            }
        ]

        # 自动检索公开网页。即使搜索服务失败，也保留号码基础查询结果。
        web_search = search_public_web(e164_format)

        data_sources = [
            {
                "name": "Google libphonenumber",
                "url": "https://github.com/google/libphonenumber",
                "fields": [
                    "号码格式",
                    "号码段有效性",
                    "号码类型",
                    "地区描述",
                    "时区",
                    "运营商号码段信息"
                ],
                "confidence": "号码规则参考",
                "limitations": (
                    "不能证明号码当前有人使用、能够接通，"
                    "也不能确认当前持有人或实时位置。"
                )
            }
        ]

        if web_search["status"] == "success":
            data_sources.append({
                "name": "Serper 公开网页搜索",
                "url": "https://serper.dev/",
                "fields": [
                    "公开网页标题",
                    "网页摘要",
                    "原始网页链接",
                    "搜索结果日期（如有）"
                ],
                "confidence": "搜索发现，尚未独立验证",
                "limitations": (
                    "搜索结果不代表号码持有人身份已被确认。"
                    "请打开原始网页核对上下文、日期和号码是否一致。"
                )
            })

        return {
            "phone_number": request.phone_number,
            "normalized_number": e164_format,
            "country": country_name,
            "region_code": region_code,
            "country_code": parsed.country_code,
            "national_number": str(parsed.national_number),
            "location": location_zh,
            "carrier": carrier_display,
            "carrier_original_name": carrier_original,
            "timezone": ", ".join(timezone_list) if timezone_list else None,
            "timezone_list": timezone_list,
            "is_valid": is_valid,
            "is_possible": is_possible,
            "type": type_description,
            "number_type_code": int(number_type),
            "international_format": international_format,
            "e164_format": e164_format,
            "mobile_format": national_format,
            "national_format": national_format,

            "data_sources": data_sources,

            "confidence": {
                "format": {
                    "level": "较高",
                    "reason": "依据号码库的号码规划规则进行格式化。"
                },
                "number_validity": {
                    "level": "规则判断",
                    "reason": (
                        "表示号码段符合号码库规则，"
                        "不代表号码已分配或正在使用。"
                    )
                },
                "carrier": {
                    "level": "参考性",
                    "reason": (
                        "可能反映原始号码段运营商，"
                        "不保证是当前运营商。"
                    )
                },
                "location": {
                    "level": "参考性",
                    "reason": (
                        "来自号码库的地区描述，"
                        "不代表持有人当前所在地。"
                    )
                },
                "public_web": {
                    "level": (
                        "已获取搜索结果，待人工核实"
                        if web_search["status"] == "success"
                        else "暂未获取搜索结果"
                    ),
                    "reason": web_search["message"]
                }
            },

            # 保留旧字段，兼容现有前端。
            "public_search_links": public_search,

            # 新字段：包含自动搜索状态、标题、摘要和原始链接。
            "public_search_results": web_search["results"],
            "public_search_status": web_search["status"],
            "public_search_message": web_search["message"],
            "public_search_total": web_search["total_results"],

            "lookup_time": time.strftime(
                "%Y-%m-%dT%H:%M:%SZ",
                time.gmtime()
            ),
            "success": True
        }

    except phonenumbers.NumberParseException:
        raise HTTPException(
            status_code=400,
            detail="号码解析失败，请检查国际号码格式。"
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="手机号查询发生错误，请稍后重试。"
        )


# -------------------------
# 用户名公开主页检查
# -------------------------

@app.post("/api/track-username")
async def track_username(request: UsernameTrackRequest):
    username = request.username

    social_media = [
        {"url": "https://www.facebook.com/{}", "name": "Facebook"},
        {"url": "https://www.instagram.com/{}", "name": "Instagram"},
        {"url": "https://www.linkedin.com/in/{}", "name": "LinkedIn"},
        {"url": "https://github.com/{}", "name": "GitHub"},
        {"url": "https://www.pinterest.com/{}", "name": "Pinterest"},
        {"url": "https://www.tumblr.com/{}", "name": "Tumblr"},
        {"url": "https://www.youtube.com/@{}", "name": "YouTube"},
        {"url": "https://soundcloud.com/{}", "name": "SoundCloud"},
        {"url": "https://www.tiktok.com/@{}", "name": "TikTok"},
        {"url": "https://www.behance.net/{}", "name": "Behance"},
        {"url": "https://medium.com/@{}", "name": "Medium"},
        {"url": "https://www.twitch.tv/{}", "name": "Twitch"}
    ]

    profiles = []

    for site in social_media:
        url = site["url"].format(username)
        profiles.append({
            "platform": site["name"],
            "url": url,
            "status": "链接已生成",
            "note": "尚未确认账号是否存在，请打开链接核实。"
        })

    return {
        "username": username,
        "total_searched": len(profiles),
        "found_count": 0,
        "profiles": profiles,
        "success": True,
        "note": "生成的是公开主页链接，不代表已确认账号存在。"
    }


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000
    )
