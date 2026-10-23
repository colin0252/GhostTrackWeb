
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
  Typography
} from 'antd';
import { SearchOutlined, CopyOutlined, SafetyOutlined } from '@ant-design/icons';
import axios from 'axios';
import { API_ENDPOINTS } from '../config/api';

const { Text, Paragraph } = Typography;

type PhoneResult = {
  phone_number?: string;
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
  return String(value);
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

      setResult(response.data);
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
          description: '搜索公开网页中的号码记录、诈骗或骚扰投诉及企业信息',
          url: `https://www.bing.com/search?q=${encodeURIComponent(
            `"${result.phone_number}" (诈骗 OR 骚扰 OR 垃圾电话 OR 企业)`
          )}`
        },
        {
          name: 'Google 公开网页搜索',
          description: '交叉搜索公开网页中的号码相关记录',
          url: `https://www.google.com/search?q=${encodeURIComponent(
            `"${result.phone_number}" (scam OR spam OR business OR fraud)`
          )}`
        }
      ]
    : [];

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError('复制失败，请长按文字手动复制。');
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Card title="手机号公开信息查询" style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          message="查询范围说明"
          description="本工具用于号码格式验证、号码段信息和公开网页线索查询。普通号码库不能确认号码当前是否有人使用，也不能获取持有人的真实身份、实时位置或私人资料。"
          style={{ marginBottom: 20 }}
        />

        <Paragraph>
          <Text type="secondary">
            请输入带有国家区号的国际号码，例如 +8613800138000。
          </Text>
        </Paragraph>

        <Space.Compact style={{ display: 'flex', width: '100%' }}>
          <Input
            aria-label="国际电话号码"
            placeholder="+8613800138000"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            onPressEnter={handleTrack}
            disabled={loading}
            maxLength={20}
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={loading}
            onClick={handleTrack}
          >
            查询号码
          </Button>
        </Space.Compact>
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
              正在查询号码信息，请稍候……
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
                {result.is_valid === true
                  ? <Tag color="success">号码段规则有效</Tag>
                  : result.is_valid === false
                    ? <Tag color="error">号码段规则未通过</Tag>
                    : '未知'}
              </Descriptions.Item>
              <Descriptions.Item label="长度是否合理">
                {result.is_possible === true
                  ? <Tag color="success">是</Tag>
                  : result.is_possible === false
                    ? <Tag color="warning">否</Tag>
                    : '暂无数据'}
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
            title="二、公开网页线索与数据可信度"
            style={{ marginBottom: 16 }}
          >
            <Paragraph>
              <Text strong>公开网页检索</Text>
            </Paragraph>

            <Paragraph type="secondary">
              以下列出针对该号码生成的公开网页检索入口。当前版本尚未自动抓取搜索引擎结果，因此这里不会把未经检索和核实的信息显示为已确认的查询结果。
            </Paragraph>

            <Space direction="vertical" style={{ width: '100%' }} size="middle">
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
                      查看网页
                    </a>
                  }
                >
                  <Text type="secondary">{item.description}</Text>
                  <div style={{ marginTop: 8 }}>
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

            <Divider />

            <Paragraph>
              <Text strong>数据来源</Text>
            </Paragraph>

            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
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
                  不保证代表当前实际运营商，可信度取决于号码规划资料、号码携转情况及元数据更新时间。
                </Paragraph>
              </div>

              <Divider style={{ margin: '4px 0' }} />

              <div>
                <Tag color="purple">公开网页线索</Tag>
                <Text strong>搜索引擎索引</Text>
                <Paragraph type="secondary">
                  用于发现公开网页中的相关线索。搜索结果需要逐条核查原始网页、发布日期和发布机构；论坛评论或用户投诉不能直接证明号码持有人实施了诈骗。
                </Paragraph>
              </div>

              <Divider style={{ margin: '4px 0' }} />

              <div>
                <SafetyOutlined style={{ marginRight: 8 }} />
                <Text strong>可信度说明</Text>
                <Paragraph type="secondary">
                  号码格式和号码段验证：参考号码库规则；运营商和地区：参考性信息；公开网页投诉和用户评论：待人工核实。当前版本尚未接入实时运营商数据库或独立反诈投诉数据库，也不会仅凭搜索结果判定号码是否安全。
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
