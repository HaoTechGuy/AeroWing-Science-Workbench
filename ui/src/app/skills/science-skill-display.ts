import type {
  ScienceSkillCategory,
  ScienceSkillSnapshot,
} from "@/app/skills/science-skill-catalog";
import type { UiLanguage } from "@/lib/i18n";

export interface ScienceSkillDisplayText {
  description: string;
  name: string;
}

const SKIP_NAME_TOKENS = new Set(["by", "from", "to"]);

const SCIENCE_TOKEN_LABELS: Record<string, string> = {
  academic: "学术",
  acceleration: "加速度",
  activity: "活性",
  admet: "ADMET",
  affinity: "亲和力",
  alanine: "丙氨酸",
  aliphatic: "脂肪环",
  alphafold: "AlphaFold",
  analysis: "分析",
  annotation: "注释",
  antibody: "抗体",
  article: "文献",
  assay: "测定",
  assessment: "评估",
  association: "关联",
  associations: "关联",
  atc: "ATC",
  atlas: "图谱",
  atmospheric: "大气科学",
  binding: "结合",
  bioassay: "生物测定",
  biology: "生物学",
  biomarker: "生物标志物",
  biomedical: "生物医学",
  biosample: "生物样本",
  blast: "BLAST",
  boltz2: "Boltz-2",
  buoyancy: "浮力",
  calculation: "计算",
  calculations: "计算",
  cancer: "癌症",
  capacitance: "电容",
  cas: "CAS",
  cell: "细胞",
  characterization: "表征",
  checker: "检查",
  chembl: "ChEMBL",
  chemical: "化学",
  chemistry: "化学",
  chromosome: "染色体",
  circuit: "电路",
  classification: "分类",
  clinical: "临床",
  code: "代码",
  combinatorial: "组合化学",
  comparative: "比较",
  comparison: "比较",
  complex: "复合物",
  compound: "化合物",
  comprehensive: "综合",
  conversion: "转换",
  counseling: "咨询",
  cross: "跨库",
  crossref: "交叉引用",
  data: "数据",
  database: "数据库",
  deep: "深度",
  denovo: "从头生成",
  density: "密度",
  descriptors: "描述符",
  design: "设计",
  development: "开发",
  discovery: "发现",
  disease: "疾病",
  dive: "深度分析",
  dleps: "DLEPS",
  dna: "DNA",
  docking: "对接",
  domain: "结构域",
  drug: "药物",
  druglikeness: "成药性",
  drugsda: "DrugSDA",
  electrical: "电学",
  electromagnetic: "电磁",
  elements: "元件",
  energy: "能量",
  engineering: "工程",
  enrichment: "富集",
  ensembl: "Ensembl",
  enzyme: "酶",
  epigenetics: "表观遗传",
  epigenomic: "表观基因组",
  error: "误差",
  esmfold: "ESMFold",
  evolution: "进化",
  executable: "可执行",
  execution: "执行",
  experimental: "实验",
  exploration: "探索",
  expression: "表达",
  extraction: "抽取",
  family: "家族",
  fda: "FDA",
  file: "文件",
  fingerprint: "指纹",
  format: "格式",
  freezing: "冰点",
  frequency: "频率",
  full: "完整",
  function: "功能",
  functional: "功能",
  gene: "基因",
  generation: "生成",
  genetic: "遗传",
  genetics: "遗传",
  genome: "基因组",
  genomic: "基因组",
  genomics: "基因组学",
  geometric: "几何",
  geometry: "几何",
  go: "GO",
  graph: "图谱",
  group: "基团",
  gwas: "GWAS",
  health: "健康",
  homology: "同源",
  hpo: "HPO",
  id: "ID",
  identification: "识别",
  ids: "ID 映射",
  impact: "影响",
  indication: "适应症",
  infectious: "感染性",
  inhibitor: "抑制剂",
  integration: "整合",
  interaction: "互作",
  interproscan: "InterProScan",
  json: "JSON",
  kegg: "KEGG",
  knowledge: "知识",
  lab: "实验室",
  landscape: "全景",
  lead: "先导化合物",
  length: "长度",
  likeness: "成药性",
  line: "系",
  linker: "连接子",
  literature: "文献",
  location: "定位",
  lookup: "查询",
  mapping: "映射",
  mass: "质量",
  material: "材料",
  maturation: "成熟",
  measurement: "测量",
  medicine: "医学",
  meta: "Meta",
  metabolism: "代谢",
  metabolomics: "代谢组",
  microbiome: "微生物组",
  mining: "挖掘",
  mobility: "迁移率",
  model: "模型",
  modeling: "建模",
  mol: "分子",
  mol2mol: "分子到分子",
  molecular: "分子",
  molecule: "分子",
  mouse: "小鼠",
  multiomics: "多组学",
  multispecies: "多物种",
  mutation: "突变",
  name: "名称",
  nanoscale: "纳米尺度",
  natural: "天然产物",
  ncbi: "NCBI",
  network: "网络",
  nexus: "关联网络",
  nuclear: "核物理",
  oceanographic: "海洋学",
  oncology: "肿瘤学",
  one: "同一健康",
  opentargets: "Open Targets",
  optical: "光学",
  optics: "光学",
  optimization: "优化",
  organism: "生物体",
  orphan: "孤儿药",
  p2rank: "P2Rank",
  pandemic: "大流行",
  patent: "专利",
  pathogenicity: "致病性",
  pathway: "通路",
  pdf: "PDF",
  pediatric: "儿科",
  peptide: "肽",
  percent: "百分比",
  personalized: "个体化",
  pharmacogenomics: "药物基因组学",
  pharmacokinetics: "药代动力学",
  pharmacology: "药理",
  phenotype: "表型",
  physics: "物理",
  pipeline: "流程",
  polymer: "聚合物",
  polypharmacology: "多药理",
  population: "群体",
  ppi: "蛋白互作",
  precision: "精准",
  prediction: "预测",
  preparedness: "准备",
  processing: "处理",
  product: "产物",
  profile: "画像",
  profiling: "画像",
  properties: "性质",
  property: "性质",
  prosst: "ProSST",
  protein: "蛋白",
  proteome: "蛋白组",
  protocol: "实验方案",
  pubchem: "PubChem",
  pubmed: "PubMed",
  quality: "质量",
  rare: "罕见病",
  region: "区域",
  regulatory: "调控",
  report: "报告",
  repurposing: "再定位",
  retrieval: "检索",
  retrieve: "检索",
  reversal: "逆转",
  rgroup: "R 基团",
  ring: "环系",
  risk: "风险",
  rna: "RNA",
  safety: "安全",
  sampling: "采样",
  scanning: "扫描",
  science: "科学",
  scientific: "科学",
  sciverse: "Sciverse",
  screen: "筛选",
  screening: "筛选",
  search: "搜索",
  seawater: "海水",
  seismic: "地震",
  sequence: "序列",
  signal: "信号",
  significance: "显著性",
  similarity: "相似性",
  site: "位点",
  smiles: "SMILES",
  snp: "SNP",
  solubility: "溶解度",
  sound: "声速",
  species: "物种",
  specific: "特异性",
  speed: "速度",
  statistical: "统计",
  string: "STRING",
  structural: "结构",
  structure: "结构",
  study: "研究",
  substance: "物质",
  substructure: "子结构",
  suite: "套件",
  synthetic: "合成",
  systems: "系统",
  target: "靶点",
  tcga: "TCGA",
  temperature: "温度",
  term: "术语",
  therapy: "治疗",
  thermal: "热学",
  tissue: "组织",
  toxicity: "毒性",
  toxicology: "毒理",
  transcriptome: "转录组",
  transfer: "传输",
  trial: "试验",
  trigonometry: "三角",
  ucsc: "UCSC",
  uniprot: "UniProt",
  unit: "单位",
  valid: "校验",
  variant: "变异",
  virtual: "虚拟",
  virus: "病毒",
  visualization: "可视化",
  volume: "体积",
  warning: "警示",
  waveform: "波形",
  web: "网页",
  wind: "风能",
};

const NAME_OVERRIDES: Record<string, string> = {
  admet_druglikeness_report: "ADMET 与成药性报告",
  affinity_maturation: "亲和力成熟流程",
  alanine_scanning_pipeline: "丙氨酸扫描突变流程",
  aliphatic_ring_analysis: "环系结构分析",
  alphafold_structure_pipeline: "AlphaFold 结构分析流程",
  "biomedical-web-search": "生物医学文献与网页搜索",
  "boltz2-binding-affinity": "Boltz-2 蛋白配体结合亲和力预测",
  "chemical-structure-analysis": "化学结构信息分析",
  "comprehensive-protein-analysis": "综合蛋白功能与进化注释",
  "comprehensive-variant-annotation": "变异综合注释",
  "drugsda-admet": "ADMET 性质预测",
  "drugsda-dleps": "DLEPS 疾病逆转评分",
  "drugsda-esmfold": "ESMFold 蛋白结构预测",
  "drugsda-p2rank": "P2Rank 结合口袋定位",
  "drugsda-prosst": "ProSST 突变效应预测",
  "gene-knowledge-integration": "基因知识整合",
  "meta-analysis-execution": "Meta 分析执行",
  "protocol-extraction-from-pdf": "PDF 实验方案抽取",
  "protocol-generation": "实验方案生成",
  "protocol-to-executable-json": "实验方案转可执行 JSON",
  "scientific-literature-search": "科学文献搜索",
  "sciverse-academic-retrieval": "Sciverse 学术文献检索",
};

const CATEGORY_FALLBACK_CAPABILITIES: Record<string, string[]> = {
  "drug-discovery-pharmacology": [
    "药物信息检索",
    "靶点与机制分析",
    "安全性和成药性评估",
  ],
  "genomics-genetic-analysis": [
    "基因和变异注释",
    "跨数据库查询",
    "遗传与表型关联分析",
  ],
  "protein-science-engineering": [
    "蛋白序列和结构分析",
    "功能注释",
    "互作和突变影响评估",
  ],
  "chemistry-molecular-science": [
    "分子结构解析",
    "理化性质计算",
    "相似性和数据库交叉查询",
  ],
  "physics-engineering-computing": [
    "工程参数计算",
    "物理模型分析",
    "单位和测量结果换算",
  ],
  "lab-automation-literature-mining": [
    "科学文献检索",
    "实验方案抽取",
    "结构化报告生成",
  ],
  "earth-environmental-science": [
    "地球环境参数计算",
    "海洋和大气模型分析",
    "现场条件评估",
  ],
  "other-scientific-computing": [
    "跨学科科学数据处理",
    "专业计算流程串联",
    "结果整理与可视化",
  ],
};

const CAPABILITY_RULES: Array<[RegExp, string]> = [
  [
    /admet|toxicity|toxicology|safety|risk|warning|adverse|boxed/i,
    "安全性与毒性评估",
  ],
  [
    /drug.?likeness|qed|lipinski|compound.?to.?drug|lead/i,
    "成药性和先导化合物评估",
  ],
  [
    /binding|affinity|docking|ligand|drug.?target|interaction/i,
    "结合亲和力和分子互作分析",
  ],
  [
    /\btarget\b|opentargets|indication|mechanism|therapy|oncology|cancer/i,
    "靶点、适应症和治疗机制分析",
  ],
  [/repurposing|reversal|dleps|disease.?compound/i, "药物再定位和疾病逆转预测"],
  [
    /pharmacokinetics|pharmacology|clinical|trial|metabolism|pediatric|pregnancy/i,
    "临床药理和药代信息整理",
  ],
  [
    /antibody|biotherapeutic|peptide|enzyme|protein.?engineering/i,
    "抗体、肽和酶工程设计",
  ],
  [
    /\bprotein\b|uniprot|alphafold|esmfold|\bpdb\b|fold|homology/i,
    "蛋白序列、结构和同源建模",
  ],
  [
    /mutation|mutagenesis|variant|snp|pathogenicity|clinvar|gnomad|gwas|pharmgkb/i,
    "突变、变异和临床意义注释",
  ],
  [
    /\bgene\b|genome|genomic|transcriptome|expression|tcga|ensembl|ucsc|kegg|\bgo\b/i,
    "基因组、表达和通路信息检索",
  ],
  [
    /phenotype|hpo|rare|orphan|counseling|population|family/i,
    "表型、罕见病和群体遗传分析",
  ],
  [
    /epigen|microbiome|metabolomics|multi.?omics|proteome/i,
    "组学数据整合和通路解析",
  ],
  [
    /smiles|pubchem|chembl|cas|molecule|molecular|chemical|compound/i,
    "化合物结构和数据库交叉查询",
  ],
  [
    /fingerprint|similarity|substructure|descriptor|logp|h.?bond|hydrophobicity/i,
    "分子指纹、相似性和理化性质计算",
  ],
  [
    /ring|functional.?group|r.?group|scaffold|linker|denovo|sampling/i,
    "分子结构片段分析和新分子生成",
  ],
  [
    /natural.?product|polymer|material|density|mass|stoichiometric/i,
    "材料、天然产物和组成性质计算",
  ],
  [
    /protocol|lab|pdf|pubmed|literature|article|sciverse|search|meta.?analysis/i,
    "文献检索、实验方案抽取和报告生成",
  ],
  [
    /code|execution|data.?processing|statistical|error|measurement/i,
    "数据处理、统计误差和自定义计算执行",
  ],
  [
    /circuit|capacitance|electrical|electromagnetic|optical|optics|thermal|nuclear/i,
    "电路、电磁、光学和热学计算",
  ],
  [
    /geometry|trigonometry|volume|length|unit|conversion|nanoscale/i,
    "几何测量和单位换算",
  ],
  [
    /atmospheric|wind|seawater|ocean|freezing|sound.?speed|seismic/i,
    "大气、海洋、风能和地震数据计算",
  ],
  [
    /virus|infectious|pandemic|one.?health|pathogen/i,
    "感染性疾病、病原体和公共卫生分析",
  ],
];

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function skillIdTokens(skillId: string): string[] {
  return skillId
    .toLowerCase()
    .split(/[-_]+/)
    .map((token) => token.trim())
    .filter((token) => token && !SKIP_NAME_TOKENS.has(token));
}

function fallbackTokenLabel(token: string): string {
  if (/^[a-z]+[0-9]+$/i.test(token)) {
    return token.toUpperCase();
  }
  return token.replace(/^\w/, (char) => char.toUpperCase());
}

function scienceSkillName(skill: ScienceSkillSnapshot): string {
  const override = NAME_OVERRIDES[skill.id];
  if (override) {
    return override;
  }

  const tokens = skillIdTokens(skill.id);
  const labels = tokens.map(
    (token) => SCIENCE_TOKEN_LABELS[token] ?? fallbackTokenLabel(token)
  );

  if (labels[0] === "DrugSDA" && labels.length > 1) {
    labels.shift();
  }

  return uniqueValues(labels)
    .join(" ")
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/gu, "$1");
}

function scienceSkillDescription(
  skill: ScienceSkillSnapshot,
  category?: ScienceSkillCategory
): string {
  const sourceText = `${skill.id} ${skill.name} ${skill.description}`;
  const capabilities = CAPABILITY_RULES.filter(([pattern]) =>
    pattern.test(sourceText)
  )
    .map(([, label]) => label)
    .slice(0, 3);
  const fallback =
    CATEGORY_FALLBACK_CAPABILITIES[skill.categoryId] ??
    CATEGORY_FALLBACK_CAPABILITIES["other-scientific-computing"];
  const selected = capabilities.length > 0 ? capabilities : fallback;
  const categoryName = category?.name ?? "科学计算";

  return `用于${categoryName}场景：${selected.join("、")}。`;
}

function englishScienceSkillName(skill: ScienceSkillSnapshot): string {
  const descriptionTitle = skill.description.split(" - ")[0]?.trim();
  if (descriptionTitle && descriptionTitle.length <= 96) {
    return descriptionTitle;
  }

  return skill.name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((token) => {
      if (/^[A-Z0-9]+$/.test(token)) {
        return token;
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

export function scienceSkillDisplayText(
  skill: ScienceSkillSnapshot,
  category?: ScienceSkillCategory,
  language: UiLanguage = "zh"
): ScienceSkillDisplayText {
  if (language === "en") {
    return {
      name: englishScienceSkillName(skill),
      description: skill.description,
    };
  }

  return {
    name: scienceSkillName(skill),
    description: scienceSkillDescription(skill, category),
  };
}
