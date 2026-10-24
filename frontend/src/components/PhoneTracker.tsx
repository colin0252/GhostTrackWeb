
import React, { useState } from 'react';
import {
  Card,
  Input,
  Button,
  Alert,
  Spin,
  Descriptions,
  Tag,
  Divider,
  Space,
  Typography,
  Empty
} from 'antd';
import { SearchOutlined, CopyOutlined, SafetyOutlined, LinkOutlined } from '@ant-design/icons';
import axios from 'axios';
import { API_ENDPOINTS } from '../config/api';

const { Text, Paragraph } = Typography;

type PublicSearchResult = {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string | null;
  source?: string;
  position?: number;
  status?: string;
  confidence?: string;
};

type PhoneResult = {
  phone_number?: string;
  normalized_number?: string;
  location?: string;
  region_code?: string;
  timezone?: string;
  carrier?: string;
  is_valid?: boolean;
  is_possible?: boolean;
  international_format?: string;
  e164_format?: string;
  mobile_format?: string;
  national_number?: string;
  country_code?: number;
  type?: string;
  success?: boolean;
  data_sources?: unknown;
  confidence?: unknown;
  public_search_results?: PublicSearchResult[];
  public_search_status?: string;
  public_search_message?: string;
  public_search_total?: number;
  public_search_links?: unknown;
};

const countryNames: Record<string, string> = {
  CN: '中国',
  US: '美国',
  ID: '印度尼西亚',
  SG: '新加坡',
  GB: '英国',
  CA: '加拿大',
  AU: '澳大利亚',
  JP: '日本',
  KR: '韩国',
  IN: '印度',
  MY: '马来西亚',
  TH: '泰国',
  VN: '越南',
  PH: '菲律宾',
  DE: '德国',
  FR: '法国',
  RU: '俄罗斯',
  BR: '巴西',
  IT: '意大利',
  ES: '西班牙',
  HK: '中国香港',
  MO: '中国澳门',
  TW: '中国台湾'
};

const carrierNames: Record<string, string> = {
  'China Telecom': '中国电信',
  'China Mobile': '中国移动',
  'China Unicom': '中国联通',
  'China Tietong': '中国铁通',
  'China Broadnet': '中国广电'
};

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '暂无数据';
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '暂无数据';
    }
  }
  return String(value);
};

const normalizeSearchStatus = (status?: string): string => {
  return (status || '').toLowerCase().replace(/[\s-]+/g, '_');
};

const getSearchStatusMessage = (result: PhoneResult): {
  type: 'success' | 'info' | 'warning' | 'error';
  message: string;
  description: string;
} => {
  const status = normalizeSearchStatus(result.public_search_status);
  const detail = result.public_search_message;

  if (
    status === 'success' ||
    status === 'ok' ||
    status === 'completed'
  ) {
    const total = result.public_search_total ?? result.public_search_results?.length ?? 0;

    if (total > 0 || (result.public_search_results?.length ?? 0) > 0) {
      return {
        type: 'success',
        message: `已获取 ${result.public_search_results?.length ?? total} 条公开网页结果`,
        description: detail || '以下内容来自搜索服务返回的公开网页索引，请打开原网页核实。'
      };
    }

    return {
      type: 'info',
      message: '未找到相关公开网页',
      description: detail || '本次搜索没有返回相关结果。这不代表号码安全，也不代表网上一定不存在相关信息。'
    };
  }

  if (
    status === 'no_results' ||
    status === 'no_result' ||
    status === 'empty'
  ) {
    return {
      type: 'info',
      message: '未找到相关公开网页',
      description: detail || '搜索服务没有找到匹配结果。没有搜索结果不代表号码安全。'
    };
  }

  if (
    status === 'not_configured' ||
    status === 'not_configured_api_key' ||
    status === 'missing_api_key' ||
    status === 'unconfigured'
  ) {
    return {
      type: 'warning',
      message: '公开网页搜索暂未配置',
      description: detail || '请检查 Render 后端的 SERPER_API_KEY 环境变量及服务部署状态。'
    };
  }

  if (
    status === 'rate_limited' ||
    status === 'quota_exceeded' ||
    status === 'limit_exceeded' ||
    status === '429'
  ) {
    return {
      type: 'warning',
      message: '搜索额度或请求频率受限',
      description: detail || '请检查搜索服务的免费额度和使用限制，稍后再试。'
    };
  }

  if (
    status === 'unauthorized' ||
    status === 'forbidden' ||
    status === '401' ||
    status === '403'
  ) {
    return {
      type: 'error',
      message: '搜索服务认证失败',
      description: detail || '请检查后端 API 密钥是否有效，以及搜索服务账户权限。'
    };
  }

  if (
    status === 'timeout' ||
    status === 'service_error' ||
    status === 'invalid_response' ||
    status === 'error' ||
    status === 'failed'
  ) {
    return {
      type: 'warning',
      message: '公开网页搜索暂时失败',
      description: detail || '搜索服务没有正常返回结果，请稍后重试。'
    };
  }

  if (result.public_search_results?.length) {
    return {
      type: 'success',
      message: `已获取 ${result.public_search_results.length} 条公开网页结果`,
      description: detail || '以下内容来自后端返回的公开网页搜索数据。'
    };
  }

  return {
    type: 'info',
    message: '暂无可展示的公开网页结果',
    description: detail || '后端没有返回可显示的网页结果。请稍后重试或查看搜索入口。'
  };
};

const PhoneTracker: React.FC = () => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PhoneResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTrack = async () => {
    const phone = phoneNumber.trim();

    if (!phone) {
      setError('请输入完整的国际格式号码，例如 +8613800138000。');
      return;
    }

    if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      setError('号码格式不正确。请使用 +国家区号+号码，例如 +8613800138000。');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await axios.post(
        API_ENDPOINTS.TRACK_PHONE,
        { phone_number: phone },
        { timeout: 30000 }
      );

      if (!response.data || typeof response.data !== 'object') {
        throw new Error('后端返回的数据格式不正确。');
      }

      setResult(response.data as PhoneResult);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail;
        setError(
          typeof detail === 'string'
            ? detail
            : err.code === 'ECONNABORTED'
              ? '查询超时，请稍后重试。'
              : '查询失败，请检查网络、号码格式或后端服务状态。'
        );
      } else if (err instanceof Error) {
        setError(err.message || '查询失败，请稍后重试。');
      } else {
        setError('发生未知错误，请稍后重试。');
      }
    } finally {
      setLoading(false);
    }
  };

  const countryCode = result?.region_code || '';
  const countryName = countryNames[countryCode] || countryCode || '未知';
  const carrierName = result?.carrier
    ? carrierNames[result.carrier] || result.carrier
    : '暂无数据';

  const publicSearchLinks = result?.phone_number
    ? [
        {
          name: '必应公开网页搜索',
          description: '在必应中查看该号码相关的公开网页',
          url: `https://www.bing.com/search?q=${encodeURIComponent(
            `"${result.phone_number}" (诈骗 OR 骚扰 OR 垃圾电话 OR 企业)`
          )}`
        },
        {
          name: 'Google 公开网页搜索',
          description: '在 Google 中交叉查找该号码相关的公开记录',
          url: `https://www.google.com/search?q=${encodeURIComponent(
            `"${result.phone_number}" (scam OR spam OR business OR fraud)`
          )}`
        }
      ]
    : [];

  const searchResults = Array.isArray(result?.public_search_results)
    ? result.public_search_results.filter(
        (item) => item && typeof item === 'object'
      )
    : [];

  const searchStatus = result ? getSearchStatusMessage(result) : null;

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError('复制失败，请长按文字手动复制。');
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 24 }}>
      <Card title="手机号公开信息查询" style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          message="查询范围说明"
          description="本工具用于号码格式验证、号码段信息和公开网页线索查询。号码库不能确认号码当前是否有人使用，也不能获取持有人的真实身份、实时位置或私人资料。"
          style={{ marginBottom: 20 }}
        />

        <Paragraph>
          <Text type="secondary">
            请输入带有国家区号的国际号码，例如 +8613800138000。
          </Text>
        </Paragraph>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!loading) {
              void handleTrack();
            }
          }}
        >
          <Space.Compact style={{ display: 'flex', width: '100%' }}>
            <Input
              aria-label="国际电话号码"
              placeholder="+8613800138000"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              disabled={loading}
              maxLength={20}
            />
            <Button
              htmlType="submit"
              type="primary"
              icon={loading ? undefined : <SearchOutlined />}
              disabled={loading}
              style={{
                minWidth: 112,
                flexShrink: 0,
                color: '#ffffff',
                fontWeight: 600,
                whiteSpace: 'nowrap'
              }}
            >
              {loading ? '查询中…' : '查询号码'}
            </Button>
          </Space.Compact>
        </form>
      </Card>

      {error && (
        <Alert
          type="error"
          showIcon
          closable
          message="查询提示"
          description={error}
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {loading && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ textAlign: 'center', padding: 36 }}>
            <Spin size="large" />
            <Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
              正在查询号码信息和公开网页，请稍候……
            </Paragraph>
          </div>
        </Card>
      )}

      {result && (
        <>
          <Card
            title="一、号码概览与归属线索"
            style={{ marginBottom: 16 }}
            extra={
              <Button
                icon={<CopyOutlined />}
                onClick={() => copyText(result.phone_number || '')}
              >
                复制号码
              </Button>
            }
          >
            <Descriptions bordered column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="查询号码">
                {displayValue(result.phone_number)}
              </Descriptions.Item>
              <Descriptions.Item label="国家或地区">
                {countryName}（{displayValue(countryCode)}）
              </Descriptions.Item>
              <Descriptions.Item label="号码有效性">
                {result.is_valid === true ? (
                  <Tag color="success">号码段规则有效</Tag>
                ) : result.is_valid === false ? (
                  <Tag color="error">号码段规则未通过</Tag>
                ) : (
                  '未知'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="长度是否合理">
                {result.is_possible === true ? (
                  <Tag color="success">是</Tag>
                ) : result.is_possible === false ? (
                  <Tag color="warning">否</Tag>
                ) : (
                  '暂无数据'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="号码类型">
                {displayValue(result.type)}
              </Descriptions.Item>
              <Descriptions.Item label="国家或地区区号">
                {result.country_code !== undefined
                  ? `+${result.country_code}`
                  : '暂无数据'}
              </Descriptions.Item>
              <Descriptions.Item label="地区描述">
                {countryName}
                {result.location &&
                result.location.toLowerCase() !== 'unknown' &&
                result.location.toLowerCase() !== 'cina'
                  ? ` / ${result.location}`
                  : ''}
              </Descriptions.Item>
              <Descriptions.Item label="号码段运营商">
                {carrierName}
              </Descriptions.Item>
              <Descriptions.Item label="时区">
                {displayValue(result.timezone)}
              </Descriptions.Item>
              {result.international_format && (
                <Descriptions.Item label="国际格式">
                  {result.international_format}
                </Descriptions.Item>
              )}
              {result.national_number && (
                <Descriptions.Item label="国家内部号码">
                  {result.national_number}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Alert
              type="warning"
              showIcon
              message="号码有效不代表正在使用"
              description="号码有效性来自号码规划和号码段元数据，并不代表号码已分配、能够接通，或当前由某个特定的人持有。运营商信息可能反映号码段的原始分配情况；号码携转、重新分配和数据更新延迟可能导致结果与当前情况不同。"
              style={{ marginTop: 16 }}
            />
          </Card>

          <Card
            title="二、自动检索的公开网页结果"
            style={{ marginBottom: 16 }}
          >
            <Paragraph type="secondary">
              以下结果由后端公开网页搜索服务返回，不是仅根据号码生成的搜索链接。请打开原网页核对内容；搜索结果本身不能证明号码持有人实施了诈骗。
            </Paragraph>

            {searchStatus && (
              <Alert
                type={searchStatus.type}
                showIcon
                message={searchStatus.message}
                description={searchStatus.description}
                style={{ marginBottom: 16 }}
              />
            )}

            {searchResults.length > 0 ? (
              <Space
                direction="vertical"
                size="middle"
                style={{ width: '100%' }}
              >
                {searchResults.map((item, index) => {
                  const safeUrl =
                    typeof item.url === 'string' &&
                    /^https?:\/\//i.test(item.url)
                      ? item.url
                      : '';

                  return (
                    <Card
                      key={`${safeUrl || item.title || 'result'}-${index}`}
                      size="small"
                      type="inner"
                      title={
                        <span>
                          <Tag color="blue">网页 {index + 1}</Tag>
                          {item.title || '未提供网页标题'}
                        </span>
                      }
                      extra={
                        safeUrl ? (
                          <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <LinkOutlined /> 原网页
                          </a>
                        ) : null
                      }
                    >
                      <Space
                        direction="vertical"
                        size={8}
                        style={{ width: '100%' }}
                      >
                        <div>
                          <Text strong>来源：</Text>
                          <Text>{item.source || '搜索结果未提供来源'}</Text>
                        </div>

                        <div>
                          <Text strong>发布日期：</Text>
                          <Text>{item.date || '网页未提供日期'}</Text>
                        </div>

                        <div>
                          <Text strong>摘要：</Text>
                          <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                            {item.snippet || '搜索服务未提供摘要，请打开原网页查看。'}
                          </Paragraph>
                        </div>

                        {safeUrl ? (
                          <div style={{ overflowWrap: 'anywhere' }}>
                            <Text strong>网页链接：</Text>
                            <a
                              href={safeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {safeUrl}
                            </a>
                          </div>
                        ) : (
                          <Text type="secondary">
                            搜索服务未提供有效的原网页链接。
                          </Text>
                        )}
                      </Space>
                    </Card>
                  );
                })}
              </Space>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前没有可展示的真实网页结果"
              />
            )}

            <Divider />

            <Paragraph>
              <Text strong>手动交叉检索</Text>
            </Paragraph>

            <Paragraph type="secondary">
              下列链接是额外的搜索入口，不属于上方已返回的网页结果。
            </Paragraph>

            <Space
              direction="vertical"
              size="middle"
              style={{ width: '100%' }}
            >
              {publicSearchLinks.map((item) => (
                <Card
                  key={item.name}
                  size="small"
                  type="inner"
                  title={item.name}
                  extra={
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      打开搜索
                    </a>
                  }
                >
                  <Text type="secondary">{item.description}</Text>
                  <div style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.url}
                    </a>
                  </div>
                </Card>
              ))}
            </Space>
          </Card>

          <Card title="三、数据来源与可信度说明" style={{ marginBottom: 16 }}>
            <Space
              direction="vertical"
              size="middle"
              style={{ width: '100%' }}
            >
              <div>
                <Tag color="blue">号码元数据</Tag>
                <Text strong>Google libphonenumber 号码库</Text>
                <Paragraph type="secondary">
                  用于号码解析、号码段规则验证、格式化、号码类型、时区及可用的归属描述。
                </Paragraph>
                <a
                  href="https://github.com/google/libphonenumber"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看号码库说明
                </a>
              </div>

              <Divider style={{ margin: '4px 0' }} />

              <div>
                <Tag color="gold">运营商线索</Tag>
                <Text strong>号码段元数据</Text>
                <Paragraph type="secondary">
                  不保证代表当前实际运营商。号码携转、重新分配和数据更新时间都可能影响结果。
                </Paragraph>
              </div>

              <Divider style={{ margin: '4px 0' }} />

              <div>
                <Tag color="purple">公开网页线索</Tag>
                <Text strong>搜索引擎索引</Text>
                <Paragraph type="secondary">
                  标题、摘要、来源、日期和链接来自后端搜索服务返回的数据。日期可能缺失，摘要可能只是网页片段，不能替代原文。网页评论或投诉也不能单独证明号码持有人实施了诈骗。
                </Paragraph>
              </div>

              <Divider style={{ margin: '4px 0' }} />

              <div>
                <SafetyOutlined style={{ marginRight: 8 }} />
                <Text strong>可信度说明</Text>
                <Paragraph type="secondary">
                  号码格式和号码段验证依据号码库规则；运营商和地区信息仅供参考；公开网页信息需要核对原始来源。当前结果不能代替运营商内部记录或官方反诈调查。
                </Paragraph>
              </div>
            </Space>

            <Divider />

            <Paragraph>
              <Text strong>核查建议</Text>
            </Paragraph>
            <ul>
              <li>优先参考政府部门、运营商和可信反诈机构发布的资料。</li>
              <li>核对网页发布日期、原始来源及是否确实指向同一个号码。</li>
              <li>没有搜索到投诉不代表号码安全；出现投诉也不一定能证明号码持有人实施了诈骗。</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
};

export default PhoneTracker;
