export const PROMPT_PLACEHOLDERS = {
  itemCount: "{{itemCount}}",
  titleList: "{{titleList}}",
};

export const DEFAULT_PROMPTS = {
  newsTop10Prompt: `你是资深双语科技新闻编辑。以下是今日 {{itemCount}} 条热点新闻标题（来自多个平台）。

任务：找出最重要、跨平台出现频率最高的 10 个热点话题，按热度排序。

输出要求：直接返回 JSON 数组，每个元素：
{"rank":1,"titleZh":"中文标题","titleEn":"English Title","summaryZh":"2句话中文核心摘要","summaryEn":"1-2 sentence English summary","sources":"来源1,来源2","refIndex":该话题最具代表性的一条新闻的序号,"url":"该条新闻的原始链接"}

强制规则：
1. titleZh 和 summaryZh 必须是自然中文，不能保留纯英文
2. titleEn 和 summaryEn 必须是自然英文
3. 不要把中英文混在同一个字段里
4. 即使原标题是英文，也必须补充准确中文；即使原标题是中文，也必须补充对应英文
5. refIndex 必须是新闻列表中的序号（1 到 {{itemCount}}），选择该话题最具代表性的一条
6. url 必须从新闻列表中原样复制，不要编造链接；如果该条新闻没有链接则留空字符串

不要返回markdown标记、不要多余解释，只返回JSON数组。

新闻列表：
{{titleList}}`,
  complianceTop10Prompt: `你是一家跨国科技公司的 DPO (Data Protection Officer)，同时也是双语合规新闻编辑。以下是今日从欧洲、英国、中国、美国、日本、韩国等多个监管机构和隐私组织抓取的 {{itemCount}} 条隐私与AI合规相关资讯标题。

你的任务：站在 DPO 的专业视角，筛选出最值得关注的 10 条重要动态，按重要程度排序。

筛选标准（优先级从高到低）：
1. 新的隐私/数据保护法律法规颁布或修订（GDPR、PIPL、CCPA、AI Act 等）
2. 监管机构执法行动（罚款、处罚决定、调查）
3. 重要判例或司法裁决
4. 监管指南、标准、白皮书发布
5. 跨境数据传输相关政策变动
6. AI 治理与算法监管动态
7. 行业影响重大的合规事件

输出要求：直接返回 JSON 数组，每个元素：
{"rank":1,"titleZh":"中文标题","titleEn":"English Title","summaryZh":"2-3句话中文摘要，说明事件内容及对企业合规的影响","summaryEn":"1-2 sentence English summary","region":"涉及地区","sources":"来源1,来源2","refIndex":该条最相关新闻的序号,"url":"该条新闻的原始链接"}

强制规则：
1. titleZh 和 summaryZh 必须是自然中文，不能返回纯英文
2. titleEn 和 summaryEn 必须是自然英文
3. 不要把中英文混在同一个字段里
4. 中文部分需要体现合规影响，英文部分保持忠实简洁
5. refIndex 必须是资讯列表中的序号（1 到 {{itemCount}}），选择该话题最相关的一条
6. url 必须从资讯列表中原样复制，不要编造链接；如果该条资讯没有链接则留空字符串

不要返回markdown标记、不要多余解释，只返回JSON数组。

资讯列表：
{{titleList}}`,
};

const REQUIRED_SCHEMA_TOKENS = {
  news: ["JSON", "titleZh", "titleEn", "summaryZh", "summaryEn", "sources", "refIndex", "url"],
  compliance: ["JSON", "titleZh", "titleEn", "summaryZh", "summaryEn", "region", "sources", "refIndex", "url"],
};

export function validatePromptTemplate(template, { fieldName = "prompt", kind = "news" } = {}) {
  const value = String(template || "").trim();
  if (!value) return `${fieldName} 不能为空`;
  if (!value.includes(PROMPT_PLACEHOLDERS.titleList)) {
    return `${fieldName} 必须包含占位符 ${PROMPT_PLACEHOLDERS.titleList}`;
  }
  if (!value.includes(PROMPT_PLACEHOLDERS.itemCount)) {
    return `${fieldName} 必须包含占位符 ${PROMPT_PLACEHOLDERS.itemCount}`;
  }
  for (const token of REQUIRED_SCHEMA_TOKENS[kind] || []) {
    if (!value.includes(token)) {
      return `${fieldName} 必须保留结构约束关键字 ${token}`;
    }
  }
  return "";
}

export function renderPromptTemplate(template, itemCount, titleList) {
  return String(template || "")
    .replaceAll(PROMPT_PLACEHOLDERS.itemCount, String(itemCount))
    .replaceAll(PROMPT_PLACEHOLDERS.titleList, titleList);
}
