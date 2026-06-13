const SEMANTIC_SEARCH_GROUPS = [
  ["技能", "能力", "插件", "创建", "生成", "封装", "复用", "skill", "workflow"],
  [
    "文档",
    "文字",
    "word",
    "doc",
    "docx",
    "报告",
    "版式",
    "批注",
    "修订",
    "导出",
  ],
  ["表格", "电子表格", "excel", "xlsx", "数据", "公式", "图表", "清洗", "整理"],
  ["幻灯片", "演示", "演示文稿", "ppt", "pptx", "slides", "模板", "讲稿"],
  ["pdf", "阅读", "合并", "拆分", "水印", "表单", "ocr", "识别", "扫描"],
  ["图片", "图像", "照片", "压缩", "转格式", "webp", "png", "jpeg", "jpg"],
  ["小红书", "社交", "媒体", "卡片", "配图", "图文", "封面", "排版"],
  ["专利", "申请", "交底", "交底书", "查新", "技术方案", "技术资料"],
  [
    "药物",
    "药理",
    "靶点",
    "admet",
    "drug",
    "pharmacology",
    "docking",
    "screening",
    "molecule",
    "ligand",
  ],
  [
    "基因",
    "基因组",
    "遗传",
    "变异",
    "罕见病",
    "genome",
    "genomics",
    "variant",
    "dna",
    "rna",
    "snp",
  ],
  [
    "蛋白",
    "蛋白质",
    "抗体",
    "肽",
    "酶",
    "结构预测",
    "protein",
    "antibody",
    "peptide",
    "enzyme",
    "alphafold",
  ],
  [
    "化学",
    "分子",
    "化合物",
    "结构",
    "指纹",
    "相似性",
    "smiles",
    "chemistry",
    "compound",
  ],
  [
    "物理",
    "工程",
    "电路",
    "热力学",
    "光学",
    "电磁",
    "单位",
    "physics",
    "engineering",
  ],
  [
    "文献",
    "论文",
    "检索",
    "实验方案",
    "实验协议",
    "protocol",
    "pubmed",
    "literature",
    "sciverse",
    "meta",
  ],
  [
    "地球",
    "环境",
    "大气",
    "海洋",
    "海水",
    "风能",
    "earth",
    "environment",
    "ocean",
    "seawater",
    "wind",
  ],
] as const;

export interface SearchDocument {
  title: string;
  description: string;
  keywords?: string[];
}

export interface PreparedSearchQuery {
  normalized: string;
  compact: string;
  terms: string[];
  expandedTerms: string[];
  chineseChars: string[];
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function chineseCharacters(value: string): string[] {
  return Array.from(value).filter((char) => /[\u3400-\u9fff]/u.test(char));
}

export function prepareSearchQuery(query: string): PreparedSearchQuery {
  const normalized = normalizeSearchText(query);
  const compact = normalized.replace(/\s+/g, "");
  const directTerms = normalized
    .split(" ")
    .map((term) => term.trim())
    .filter(Boolean);
  const expandedTerms: string[] = [];

  for (const group of SEMANTIC_SEARCH_GROUPS) {
    const normalizedGroup = group.map((term) => normalizeSearchText(term));
    const groupMatches = normalizedGroup.some((term) => {
      const compactTerm = term.replace(/\s+/g, "");
      return (
        Boolean(term) &&
        (normalized.includes(term) ||
          compact.includes(compactTerm) ||
          compactTerm.includes(compact))
      );
    });
    if (groupMatches) {
      expandedTerms.push(...normalizedGroup);
    }
  }

  return {
    normalized,
    compact,
    terms: uniqueValues([normalized, compact, ...directTerms]),
    expandedTerms: uniqueValues(expandedTerms),
    chineseChars: chineseCharacters(compact),
  };
}

function documentSearchText(document: SearchDocument): string {
  return normalizeSearchText(
    [document.title, document.description, ...(document.keywords ?? [])].join(
      " "
    )
  );
}

export function scoreSearchDocument(
  document: SearchDocument,
  query: PreparedSearchQuery
): number {
  if (!query.normalized) {
    return 1;
  }

  const text = documentSearchText(document);
  const compactText = text.replace(/\s+/g, "");
  let score = 0;

  if (text.includes(query.normalized) || compactText.includes(query.compact)) {
    score += 120;
  }

  for (const term of query.terms) {
    const compactTerm = term.replace(/\s+/g, "");
    if (term && text.includes(term)) {
      score += 24;
    } else if (compactTerm && compactText.includes(compactTerm)) {
      score += 18;
    }
  }

  for (const term of query.expandedTerms) {
    const compactTerm = term.replace(/\s+/g, "");
    if (term && text.includes(term)) {
      score += 14;
    } else if (compactTerm && compactText.includes(compactTerm)) {
      score += 10;
    }
  }

  if (query.chineseChars.length >= 2) {
    const matchedChars = query.chineseChars.filter((char) =>
      compactText.includes(char)
    ).length;
    if (matchedChars >= 2 && matchedChars / query.chineseChars.length >= 0.6) {
      score += 8 + matchedChars;
    }
  }

  return score;
}

export function filterAndRankBySearch<T>(
  items: readonly T[],
  query: PreparedSearchQuery,
  documentForItem: (item: T) => SearchDocument
): T[] {
  if (!query.normalized) {
    return [...items];
  }

  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreSearchDocument(documentForItem(item), query),
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((result) => result.item);
}
