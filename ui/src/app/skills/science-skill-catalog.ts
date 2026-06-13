// Generated from https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills
// Snapshot contains 207 scientific skills. Install actions download from GitHub.

export interface ScienceSkillCategory {
  id: string;
  name: string;
  description: string;
  count: number;
}

export interface ScienceSkillSnapshot {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  sourcePath: string;
  installUrl: string;
}

export const SCIENCE_SKILL_SOURCE = {
  repo: "InternScience/scp",
  commit: "cea5398564032aea65a78e246d06c30ae945e03f",
  branch: "main",
  total: 207,
} as const;

export const SCIENCE_SKILL_CATEGORIES = [
  {
    id: "drug-discovery-pharmacology",
    name: "药物发现与药理",
    description: "靶点识别、ADMET 预测、虚拟筛选、分子对接、药物安全与再定位。",
    count: 71,
  },
  {
    id: "genomics-genetic-analysis",
    name: "基因组与遗传分析",
    description:
      "变异致病性、癌症基因组、群体遗传、罕见病、病毒基因组和表观组学。",
    count: 41,
  },
  {
    id: "protein-science-engineering",
    name: "蛋白科学与工程",
    description:
      "结构预测、结合位点、突变影响、抗体与肽设计、酶工程和蛋白互作。",
    count: 38,
  },
  {
    id: "chemistry-molecular-science",
    name: "化学与分子科学",
    description:
      "分子结构、指纹与相似性、SAR、材料组成、天然产物和代谢组分析。",
    count: 24,
  },
  {
    id: "physics-engineering-computing",
    name: "物理与工程计算",
    description: "电路、热力学、光学、电磁学、晶体学、几何测量和单位换算。",
    count: 18,
  },
  {
    id: "lab-automation-literature-mining",
    name: "实验自动化与文献挖掘",
    description:
      "实验方案生成、PDF 协议抽取、PubMed 与科学文献检索、Meta 分析。",
    count: 8,
  },
  {
    id: "earth-environmental-science",
    name: "地球与环境科学",
    description: "大气科学、风能评估、海水性质、海洋声速和冰点计算。",
    count: 5,
  },
  {
    id: "other-scientific-computing",
    name: "其他科学计算",
    description: "跨学科数据库、地震波形、纳米尺度单位换算等补充科学能力。",
    count: 2,
  },
] satisfies readonly ScienceSkillCategory[];

export const SCIENCE_SKILLS = [
  {
    id: "admet_druglikeness_report",
    name: "admet_druglikeness_report",
    description:
      "ADMET & Drug-Likeness Report - Generate comprehensive ADMET and drug-likeness report: molecular properties, H-bond analysis, hydrophobicity, topology, and ADMET prediction. Use this skill for medicinal chemistry tasks involving calculate mol basic info calculate mol hbond calculate mol hydrophobicity calculate mol topology pred molecule admet. Combines 5 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/admet_druglikeness_report",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/admet_druglikeness_report",
  },
  {
    id: "affinity_maturation",
    name: "affinity_maturation",
    description:
      "Affinity Maturation Pipeline - Affinity maturation: compute binding affinity, predict mutations, compute hydrophilicity, and predict drug-target interaction. Use this skill for antibody engineering tasks involving ComputeAffinityCalculator zero shot sequence prediction ComputeHydrophilicity PredictDrugTargetInteraction. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/affinity_maturation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/affinity_maturation",
  },
  {
    id: "alanine_scanning_pipeline",
    name: "alanine_scanning_pipeline",
    description:
      "Alanine Scanning Mutagenesis Pipeline - Alanine scanning: design scan, compute properties for each mutant, predict interactions, and compare. Use this skill for protein biochemistry tasks involving AlanineScanningDesigner ComputeProtPara PredictDrugTargetInteraction calculate protein sequence properties. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/alanine_scanning_pipeline",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/alanine_scanning_pipeline",
  },
  {
    id: "aliphatic_ring_analysis",
    name: "aliphatic_ring_analysis",
    description:
      "Ring System Analysis - Analyze ring systems: count aliphatic carbocycles, analyze aromaticity, compute topology, and structure complexity. Use this skill for organic chemistry tasks involving GetAliphaticCarbocyclesNum AromaticityAnalyzer calculate mol topology calculate mol structure complexity. Combines 4 tools from 3 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/aliphatic_ring_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/aliphatic_ring_analysis",
  },
  {
    id: "alphafold_structure_pipeline",
    name: "alphafold_structure_pipeline",
    description:
      "AlphaFold Structure Analysis Pipeline - AlphaFold pipeline: download predicted structure, predict pockets, extract sequence, and compute properties. Use this skill for computational biology tasks involving download alphafold structure run fpocket extract pdb sequence calculate pdb basic info. Combines 4 tools from 3 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/alphafold_structure_pipeline",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/alphafold_structure_pipeline",
  },
  {
    id: "antibody_drug_development",
    name: "antibody_drug_development",
    description:
      "Antibody Drug Development - Develop antibody drug: target protein analysis, biotherapeutic lookup, protein properties, and interaction prediction. Use this skill for biologics tasks involving get uniprotkb entry by accession get biotherapeutic by name ComputeProtPara ComputeHydrophilicity. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/antibody_drug_development",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/antibody_drug_development",
  },
  {
    id: "antibody_target_analysis",
    name: "antibody_target_analysis",
    description:
      "Antibody-Target Analysis - Analyze an antibody target: UniProt protein info, InterPro domains, protein properties, and biotherapeutic data from ChEMBL. Use this skill for immunology tasks involving get uniprotkb entry by accession query interpro ComputeProtPara get biotherapeutic by name. Combines 4 tools from 4 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/antibody_target_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/antibody_target_analysis",
  },
  {
    id: "atc_drug_classification",
    name: "atc_drug_classification",
    description:
      "ATC Drug Classification Lookup - Look up drug in ATC classification: ChEMBL ATC class, FDA drug info, PubChem compound, and mechanism of action. Use this skill for pharmacology tasks involving get atc class by level5 get mechanism of action by drug name get compound by name get drug by name. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/atc_drug_classification",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/atc_drug_classification",
  },
  {
    id: "atmospheric-science-calculations",
    name: "atmospheric-science-calculations",
    description:
      "Calculate atmospheric parameters including Coriolis parameter, geostrophic wind, heat index, potential temperature, and dewpoint for meteorology and climate science.",
    categoryId: "earth-environmental-science",
    sourcePath: "skills/atmospheric-science-calculations",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/atmospheric-science-calculations",
  },
  {
    id: "binding_site_characterization",
    name: "binding_site_characterization",
    description:
      "Binding Site Characterization - Characterize binding sites: predict pockets with fpocket and P2Rank, get binding site info from ChEMBL, and visualize. Use this skill for structural biology tasks involving run fpocket pred pocket prank get binding site by id visualize protein. Combines 4 tools from 3 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/binding_site_characterization",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/binding_site_characterization",
  },
  {
    id: "bioassay_analysis",
    name: "bioassay_analysis",
    description:
      "Bioassay Data Analysis - Analyze bioassay data: PubChem assay summary, ChEMBL activity search, compound properties, and target info. Use this skill for bioassay science tasks involving get assay summary by cid search activity calculate mol basic info get target by name. Combines 4 tools from 3 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/bioassay_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/bioassay_analysis",
  },
  {
    id: "biomarker_discovery",
    name: "biomarker_discovery",
    description:
      "Biomarker Discovery Pipeline - Discover biomarkers: TCGA differential expression, NCBI gene data, OpenTargets associations, and clinical relevance. Use this skill for precision medicine tasks involving tcga differential expression analysis get gene metadata by gene name get associated targets by disease efoId clinvar search. Combines 4 tools from 4 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/biomarker_discovery",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/biomarker_discovery",
  },
  {
    id: "biomedical-web-search",
    name: "biomedical-web-search",
    description:
      "Search biomedical literature and web content using Tavily search engine for research and clinical information.",
    categoryId: "lab-automation-literature-mining",
    sourcePath: "skills/biomedical-web-search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/biomedical-web-search",
  },
  {
    id: "biosample_genomics",
    name: "biosample_genomics",
    description:
      "BioSample & Genome Cross-Reference - Cross-reference biosample and genome data: NCBI biosample, genome report, sequence reports, and taxonomy. Use this skill for genomics tasks involving get biosample report get genome dataset report by accession get genome sequence reports get taxonomy. Combines 4 tools from 1 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/biosample_genomics",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/biosample_genomics",
  },
  {
    id: "blast_protein_analysis",
    name: "blast_protein_analysis",
    description:
      "BLAST & Protein Analysis Pipeline - BLAST search followed by comprehensive protein analysis: BLAST, then structure prediction, properties, and function. Use this skill for sequence bioinformatics tasks involving blast search pred protein structure esmfold calculate protein sequence properties predict protein function. Combines 4 tools from 4 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/blast_protein_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/blast_protein_analysis",
  },
  {
    id: "boltz2-binding-affinity",
    name: "boltz2-binding-affinity",
    description:
      "Predict protein-ligand binding affinity using Boltz-2 model to assess molecular interactions and binding probability for drug discovery.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/boltz2-binding-affinity",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/boltz2-binding-affinity",
  },
  {
    id: "buoyancy-acceleration-calculation",
    name: "buoyancy-acceleration-calculation",
    description:
      "Calculate buoyancy forces and acceleration for fluid mechanics and hydrodynamics analysis.",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/buoyancy-acceleration-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/buoyancy-acceleration-calculation",
  },
  {
    id: "cancer_therapy_design",
    name: "cancer_therapy_design",
    description:
      "Cancer Therapy Design - Design cancer therapy: identify targets, find drugs, check safety, and analyze differential expression. Use this skill for oncology tasks involving get associated targets by disease efoId get associated drugs by target name get adverse reactions by drug name tcga differential expression analysis. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/cancer_therapy_design",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/cancer_therapy_design",
  },
  {
    id: "capacitance-calculation",
    name: "capacitance-calculation",
    description:
      "Calculate electrical capacitance from geometric parameters and dielectric properties for circuit design.",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/capacitance-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/capacitance-calculation",
  },
  {
    id: "cas_compound_lookup",
    name: "cas_compound_lookup",
    description:
      "CAS Number Compound Lookup - Look up compounds by CAS: convert CAS to price/availability, get PubChem data, get ChEMBL info, and structure analysis. Use this skill for chemical information tasks involving CASToPrice get compound by name get molecule by name ChemicalStructureAnalyzer. Combines 4 tools from 4 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/cas_compound_lookup",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/cas_compound_lookup",
  },
  {
    id: "cell_line_assay_analysis",
    name: "cell_line_assay_analysis",
    description:
      "Cell Line Assay Analysis - Analyze cell line assays: ChEMBL cell line info, assay search, activity data, and target info. Use this skill for cell biology tasks involving get cell line by id search assay search activity get target by name. Combines 4 tools from 1 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/cell_line_assay_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/cell_line_assay_analysis",
  },
  {
    id: "chembl-molecule-search",
    name: "chembl-molecule-search",
    description:
      "Search ChEMBL database for molecule information by name to retrieve bioactivity data and chemical structures.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/chembl-molecule-search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/chembl-molecule-search",
  },
  {
    id: "chemical_patent_analysis",
    name: "chemical_patent_analysis",
    description:
      "Chemical Patent & Novelty Analysis - Analyze chemical novelty: PubChem substructure CAS search, ChEMBL similarity search, compound synonyms, and literature. Use this skill for patent chemistry tasks involving get substructure cas get similarity by smiles get compound synonyms by name search literature. Combines 4 tools from 3 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/chemical_patent_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/chemical_patent_analysis",
  },
  {
    id: "chemical_property_profiling",
    name: "chemical_property_profiling",
    description:
      "Chemical Property Profiling - Profile chemical properties: basic info, hydrophobicity, H-bonds, charges, and molecular complexity. Use this skill for physical chemistry tasks involving calculate mol basic info calculate mol hydrophobicity calculate mol hbond calculate mol charge calculate mol complexity. Combines 5 tools from 1 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/chemical_property_profiling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/chemical_property_profiling",
  },
  {
    id: "chemical_safety_assessment",
    name: "chemical_safety_assessment",
    description:
      "Chemical Safety Assessment - Assess chemical safety: PubChem compound info, FDA drug data, ADMET prediction, and structural alerts from ChEMBL. Use this skill for chemical safety tasks involving get general info by compound name get warnings and cautions by drug name pred molecule admet get compound structural alert. Combines 4 tools from 4 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/chemical_safety_assessment",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/chemical_safety_assessment",
  },
  {
    id: "chemical_structure_comparison",
    name: "chemical_structure_comparison",
    description:
      "Chemical Structure Comparison - Compare chemical structures: get SMILES, analyze structures, compute similarity, and check PubChem records. Use this skill for cheminformatics tasks involving NameToSMILES ChemicalStructureAnalyzer calculate smiles similarity get compound by name. Combines 4 tools from 4 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/chemical_structure_comparison",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/chemical_structure_comparison",
  },
  {
    id: "chemical-mass-percent-calculation",
    name: "chemical-mass-percent-calculation",
    description:
      "Calculate mass percentages and stoichiometric ratios for chemical reactions and compound compositions.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/chemical-mass-percent-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/chemical-mass-percent-calculation",
  },
  {
    id: "chemical-structure-analysis",
    name: "chemical-structure-analysis",
    description:
      "Analyze chemical structures from compound names to retrieve SMILES, molecular formulas, molecular weight, and LogP values.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/chemical-structure-analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/chemical-structure-analysis",
  },
  {
    id: "chromosome_analysis",
    name: "chromosome_analysis",
    description:
      "Chromosome Structure Analysis - Analyze chromosome: NCBI summary, UCSC cytoband, genome sequence, and Ensembl assembly info. Use this skill for cytogenetics tasks involving get chromosome summary get cytoband get chromosome sequence get info assembly. Combines 4 tools from 3 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/chromosome_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/chromosome_analysis",
  },
  {
    id: "clinical_pharmacology_report",
    name: "clinical_pharmacology_report",
    description:
      "Clinical Pharmacology Report - Generate clinical pharmacology report: PK, PD, mechanism, drug interactions, and special populations. Use this skill for clinical pharmacology tasks involving get pharmacokinetics by drug name get pharmacodynamics by drug name get mechanism of action by drug name get drug interactions by drug name get geriatric use info by drug name. Combines 5 tools from 1 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/clinical_pharmacology_report",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/clinical_pharmacology_report",
  },
  {
    id: "clinical_trial_drug_profile",
    name: "clinical_trial_drug_profile",
    description:
      "Clinical Trial Drug Profiling - Profile drug for clinical trials: FDA clinical studies, contraindications, pregnancy info, and geriatric use. Use this skill for clinical research tasks involving get clinical studies info by drug name get contraindications by drug name get pregnancy effects info by drug name get geriatric use info by drug name. Combines 4 tools from 1 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/clinical_trial_drug_profile",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/clinical_trial_drug_profile",
  },
  {
    id: "code_execution_analysis",
    name: "code_execution_analysis",
    description:
      "Computational Analysis via Code Execution - Execute custom computational analysis code, analyze software, and search for reference implementations. Use this skill for computational science tasks involving exec code software analysis search dataset search literature. Combines 4 tools from 2 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/code_execution_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/code_execution_analysis",
  },
  {
    id: "combinatorial_chemistry",
    name: "combinatorial_chemistry",
    description:
      "Combinatorial Chemistry Library Design - Design combinatorial library: validate core SMILES, generate variants, compute properties, and predict ADMET for library. Use this skill for combinatorial chemistry tasks involving is valid smiles calculate mol basic info calculate mol drug chemistry pred molecule admet. Combines 4 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/combinatorial_chemistry",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/combinatorial_chemistry",
  },
  {
    id: "comparative_drug_analysis",
    name: "comparative_drug_analysis",
    description:
      "Comparative Drug Analysis - Compare drugs: structure analysis, PubChem data, FDA safety, and ChEMBL bioactivity. Use this skill for comparative pharmacology tasks involving ChemicalStructureAnalyzer get compound by name get adverse reactions by drug name search activity. Combines 4 tools from 4 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/comparative_drug_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/comparative_drug_analysis",
  },
  {
    id: "compound_database_crossref",
    name: "compound_database_crossref",
    description:
      "Cross-Database Compound Lookup - Cross-reference compound across databases: PubChem, ChEMBL, KEGG, and CAS number lookup. Use this skill for chemical information tasks involving get compound by name get molecule by name kegg find CASToPrice. Combines 4 tools from 4 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/compound_database_crossref",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/compound_database_crossref",
  },
  {
    id: "compound_to_drug_pipeline",
    name: "compound_to_drug_pipeline",
    description:
      "Compound-to-Drug Analysis Pipeline - Full compound-to-drug pipeline: name-to-SMILES conversion, structure analysis, drug-likeness, and FDA drug lookup. Use this skill for drug development tasks involving NameToSMILES ChemicalStructureAnalyzer calculate mol drug chemistry get drug by name. Combines 4 tools from 4 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/compound_to_drug_pipeline",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/compound_to_drug_pipeline",
  },
  {
    id: "compound-name-retrieval",
    name: "compound-name-retrieval",
    description:
      "Retrieve SMILES strings from PubChem database using compound names to obtain molecular structures from common chemical names.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/compound-name-retrieval",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/compound-name-retrieval",
  },
  {
    id: "comprehensive-protein-analysis",
    name: "comprehensive-protein-analysis",
    description:
      "Comprehensive protein analysis combining InterProScan domain identification with BLAST similarity search to provide complete functional and evolutionary annotation.",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/comprehensive-protein-analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/comprehensive-protein-analysis",
  },
  {
    id: "comprehensive-variant-annotation",
    name: "comprehensive-variant-annotation",
    description:
      "Given an rsID, query multiple databases (dbSNP, FAVOR, GWAS Catalog, ClinVar, gnomAD, PharmGKB, ClinGen) for comprehensive annotation. Use when user asks a general question about a variant without specifying which aspect.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/comprehensive-variant-annotation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/comprehensive-variant-annotation",
  },
  {
    id: "cross_species_genomics",
    name: "cross_species_genomics",
    description:
      "Cross-Species Comparative Genomics - Compare genomes across species: Ensembl compara, alignment, gene trees, and NCBI taxonomy. Use this skill for comparative genomics tasks involving get info compara species sets get alignment region get genetree member symbol get taxonomy. Combines 4 tools from 2 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/cross_species_genomics",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/cross_species_genomics",
  },
  {
    id: "disease_compound_pipeline",
    name: "disease_compound_pipeline",
    description:
      "Disease-Specific Compound Screening - Screen compounds for disease: get DLEPS score for disease relevance, predict ADMET, and check drug-likeness. Use this skill for drug discovery tasks involving calculate dleps score pred molecule admet calculate mol drug chemistry get compound by name. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/disease_compound_pipeline",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/disease_compound_pipeline",
  },
  {
    id: "disease_drug_landscape",
    name: "disease_drug_landscape",
    description:
      "Disease-Drug Landscape Analysis - Map the drug landscape for a disease: OpenTargets disease drugs, FDA indications, and clinical studies. Use this skill for drug discovery tasks involving get associated drugs by target name get drug names by indication get clinical studies info by drug name. Combines 3 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/disease_drug_landscape",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/disease_drug_landscape",
  },
  {
    id: "disease_knowledge_graph",
    name: "disease_knowledge_graph",
    description:
      "Disease Knowledge Graph - Build disease knowledge graph: OpenTargets targets, drugs, publications, and phenotypes. Use this skill for disease informatics tasks involving get associated targets by disease efoId get associated drugs by target name get publications by drug name get associated phenotypes by disease efoId. Combines 4 tools from 1 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/disease_knowledge_graph",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/disease_knowledge_graph",
  },
  {
    id: "disease_protein_profiling",
    name: "disease_protein_profiling",
    description:
      "Disease Protein Profiling - Profile a disease protein: UniProt data, AlphaFold structure, InterPro domains, phenotype associations from Ensembl. Use this skill for medical proteomics tasks involving query uniprot download alphafold structure query interpro get phenotype gene. Combines 4 tools from 2 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/disease_protein_profiling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/disease_protein_profiling",
  },
  {
    id: "disease-reversal-prediction",
    name: "disease-reversal-prediction",
    description:
      "Predict a molecule's ability to reverse disease states using DLEPS (Disease-Ligand Embedding Projection Score) for drug repositioning and discovery.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/disease-reversal-prediction",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/disease-reversal-prediction",
  },
  {
    id: "dna-rna-sequence-analysis",
    name: "dna-rna-sequence-analysis",
    description:
      "Analyze DNA and RNA sequences including molecular weight calculation, reverse complement generation, and oligonucleotide properties.",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/dna-rna-sequence-analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/dna-rna-sequence-analysis",
  },
  {
    id: "drug_indication_mapping",
    name: "drug_indication_mapping",
    description:
      "Drug-Indication Mapping - Map drug indications: ChEMBL drug indications, FDA indications, OpenTargets drug associations, and literature. Use this skill for clinical informatics tasks involving get drug indication by id get indications by drug name get associated drugs by target name pubmed search. Combines 4 tools from 4 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drug_indication_mapping",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drug_indication_mapping",
  },
  {
    id: "drug_interaction_checker",
    name: "drug_interaction_checker",
    description:
      "Drug-Drug Interaction Checker - Check interactions between multiple drugs using FDA interaction data, PubChem compound info, and ChEMBL target overlap analysis. Use this skill for clinical pharmacology tasks involving get drug interactions by drug name get compound by name get target by name. Combines 3 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drug_interaction_checker",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drug_interaction_checker",
  },
  {
    id: "drug_metabolism_study",
    name: "drug_metabolism_study",
    description:
      "Drug Metabolism Study - Study drug metabolism: FDA metabolism data, ChEMBL metabolism records, PubChem compound data, and clinical pharmacology. Use this skill for drug metabolism tasks involving get metabolism by id get pharmacokinetics by drug name get compound by name get clinical pharmacology by drug name. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drug_metabolism_study",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drug_metabolism_study",
  },
  {
    id: "drug_repurposing_screen",
    name: "drug_repurposing_screen",
    description:
      "Drug Repurposing Screening - Screen existing drugs for new indications by querying FDA indications, ChEMBL mechanisms, and OpenTargets drug-disease associations. Use this skill for drug discovery tasks involving get indications by drug name get mechanism of action by drug name get drug by name get associated drugs by target name. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drug_repurposing_screen",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drug_repurposing_screen",
  },
  {
    id: "drug_safety_profile",
    name: "drug_safety_profile",
    description:
      "Comprehensive Drug Safety Profile - Build a complete drug safety profile by combining FDA adverse reactions, boxed warnings, drug interactions, and contraindications. Use this skill for pharmacology tasks involving get adverse reactions by drug name get boxed warning info by drug name get drug interactions by drug name get contraindications by drug name. Combines 4 tools from 1 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drug_safety_profile",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drug_safety_profile",
  },
  {
    id: "drug_target_identification",
    name: "drug_target_identification",
    description:
      "Drug Target Identification Pipeline - Identify drug targets for a disease by querying OpenTargets for associated targets, then retrieve detailed target info from ChEMBL and protein data from UniProt. Use this skill for drug discovery tasks involving get associated targets by disease efoId get target by name get general info by protein or gene name. Combines 3 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drug_target_identification",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drug_target_identification",
  },
  {
    id: "drug_target_structure",
    name: "drug_target_structure",
    description:
      "Drug-Target Structural Biology - Integrate drug and target structure: get drug from ChEMBL, target structure from PDB, dock them, and predict ADMET. Use this skill for structural pharmacology tasks involving get drug by name retrieve protein data by pdbcode quick molecule docking pred molecule admet. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drug_target_structure",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drug_target_structure",
  },
  {
    id: "drug_warning_report",
    name: "drug_warning_report",
    description:
      "Drug Warning Intelligence Report - Generate drug warning report: ChEMBL drug warnings, FDA boxed warnings, adverse reactions, and environmental warnings. Use this skill for pharmacovigilance tasks involving get drug warning by id get boxed warning info by drug name get adverse reactions by drug name get environmental warning by drug name. Combines 4 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drug_warning_report",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drug_warning_report",
  },
  {
    id: "drug-screening-docking",
    name: "drug-screening-docking",
    description:
      "Comprehensive drug screening pipeline from molecular filtering through QED/ADMET criteria to protein-ligand docking, identifying promising drug candidates.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drug-screening-docking",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drug-screening-docking",
  },
  {
    id: "drugsda-admet",
    name: "drugsda-admet",
    description:
      "Predict the ADMET (absorption, distribution, metabolism, excretion, and toxicity) properties of the input molecules.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-admet",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-admet",
  },
  {
    id: "drugsda-compound-retrieve",
    name: "drugsda-compound-retrieve",
    description: "Retrieve SMILES strings from PubChem using compound names.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-compound-retrieve",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-compound-retrieve",
  },
  {
    id: "drugsda-data-valid",
    name: "drugsda-data-valid",
    description:
      "Check if the input protein sequence or molecule SMILES string is valid.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-data-valid",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-data-valid",
  },
  {
    id: "drugsda-denovo-sampling",
    name: "drugsda-denovo-sampling",
    description: "Generate new molecules de novo.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-denovo-sampling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-denovo-sampling",
  },
  {
    id: "drugsda-dleps",
    name: "drugsda-dleps",
    description:
      "Calculate disease reversal scores for the provided molecules relative to a specific disease.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-dleps",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-dleps",
  },
  {
    id: "drugsda-drug-likeness",
    name: "drugsda-drug-likeness",
    description:
      "Compute the drug-likeness metrics (QED score and Number of violations of Lipinski's Rule of Five) of the input candidate molecules (SMILES format).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-drug-likeness",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-drug-likeness",
  },
  {
    id: "drugsda-esmfold",
    name: "drugsda-esmfold",
    description:
      "Use ESMFold model to predict 3D structure of the input protein sequence.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-esmfold",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-esmfold",
  },
  {
    id: "drugsda-file-transfer",
    name: "drugsda-file-transfer",
    description:
      "Implement data transmission between the local computer and the MCP Server using Base64 encoding",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-file-transfer",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-file-transfer",
  },
  {
    id: "drugsda-linker-sampling",
    name: "drugsda-linker-sampling",
    description:
      "Generate new molecules sampling from the input two warhead fragments.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-linker-sampling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-linker-sampling",
  },
  {
    id: "drugsda-mol-properties",
    name: "drugsda-mol-properties",
    description:
      "Calculate different types of molecular properties based on SMILES strings, covering basic physicochemical properties, hydrophobicity, hydrogen bonding capability, molecular complexity, topological structures, charge distribution, and custom complexity metrics, respectively.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-mol-properties",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-mol-properties",
  },
  {
    id: "drugsda-mol-similarity",
    name: "drugsda-mol-similarity",
    description:
      "Compute the Tanimoto similarities between a target molecule and a list of candidate molecules using Morgan fingerprints.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-mol-similarity",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-mol-similarity",
  },
  {
    id: "drugsda-mol2mol-sampling",
    name: "drugsda-mol2mol-sampling",
    description: "Generate new molecules sampling from the input molecule.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-mol2mol-sampling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-mol2mol-sampling",
  },
  {
    id: "drugsda-p2rank",
    name: "drugsda-p2rank",
    description: "P2Rank Pocket Location",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-p2rank",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-p2rank",
  },
  {
    id: "drugsda-peptide-sampling",
    name: "drugsda-peptide-sampling",
    description:
      "Generate new peptide molecules sampling from the input peptide sequence.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-peptide-sampling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-peptide-sampling",
  },
  {
    id: "drugsda-prosst",
    name: "drugsda-prosst",
    description:
      "Given a protein sequence and its structure, employ ProSST model to predict mutation effects and obtain the top-k mutated sequences.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-prosst",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-prosst",
  },
  {
    id: "drugsda-rgroup-sampling",
    name: "drugsda-rgroup-sampling",
    description: "Generate new molecules sampling from the input scaffold.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-rgroup-sampling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-rgroup-sampling",
  },
  {
    id: "drugsda-target-retrieve",
    name: "drugsda-target-retrieve",
    description:
      "Search the protein information from the input gene name and downloads the optimal PDB or AlphaFold structures.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/drugsda-target-retrieve",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/drugsda-target-retrieve",
  },
  {
    id: "electrical_circuit_analysis",
    name: "electrical_circuit_analysis",
    description:
      "Electrical Circuit Analysis - Analyze electrical circuit: compute capacitance, convert resistance units, calculate total charge, and duty cycle. Use this skill for electrical engineering tasks involving convert resistance kOhm to Ohm calculate geometric term calculate absolute error. Combines 3 tools from 3 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/electrical_circuit_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/electrical_circuit_analysis",
  },
  {
    id: "electromagnetic_analysis",
    name: "electromagnetic_analysis",
    description:
      "Electromagnetic Field Analysis - Analyze EM fields: vacuum permittivity, total charge, radiation pressure, and photon calculations. Use this skill for electromagnetics tasks involving calculate vacuum permittivity calculate total charge calculate radiation pressure calculate total power. Combines 4 tools from 2 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/electromagnetic_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/electromagnetic_analysis",
  },
  {
    id: "energy_conversion",
    name: "energy_conversion",
    description:
      "Energy Unit Conversion Pipeline - Convert between energy units and analyze: MeV to Joules, scientific notation, and error calculation. Use this skill for physics tasks involving convert energy MeV to J convert to scientific notation format scientific notation calculate absolute error. Combines 4 tools from 2 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/energy_conversion",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/energy_conversion",
  },
  {
    id: "ensembl-sequence-retrieval",
    name: "ensembl-sequence-retrieval",
    description:
      "Retrieve genomic sequences from Ensembl database using transcript or gene IDs to obtain nucleotide and protein sequences.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/ensembl-sequence-retrieval",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/ensembl-sequence-retrieval",
  },
  {
    id: "enzyme_engineering",
    name: "enzyme_engineering",
    description:
      "Enzyme Active Site Engineering - Engineer enzyme: identify active site residues, predict pocket, analyze binding site, and predict mutations. Use this skill for enzymology tasks involving predict functional residue run fpocket get binding site by id pred mutant sequence. Combines 4 tools from 3 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/enzyme_engineering",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/enzyme_engineering",
  },
  {
    id: "enzyme_inhibitor_design",
    name: "enzyme_inhibitor_design",
    description:
      "Enzyme Inhibitor Design - Design enzyme inhibitor: target structure, pocket prediction, compound screening, and ADMET assessment. Use this skill for enzyme pharmacology tasks involving retrieve protein data by pdbcode pred pocket prank quick molecule docking pred molecule admet calculate mol drug chemistry. Combines 5 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/enzyme_inhibitor_design",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/enzyme_inhibitor_design",
  },
  {
    id: "epigenetics_drug",
    name: "epigenetics_drug",
    description:
      "Epigenetics & Drug Response - Link epigenetics to drug response: gene regulation, variant effects, drug interactions, and expression. Use this skill for epigenetic pharmacology tasks involving get overlap region get vep hgvs get drug interactions by drug name get gene expression across cancers. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/epigenetics_drug",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/epigenetics_drug",
  },
  {
    id: "epigenomic_landscape",
    name: "epigenomic_landscape",
    description:
      "Epigenomic Landscape Mapping - Map epigenomic landscape: overlapping features, regulatory elements, binding matrices, and phenotype links. Use this skill for epigenomics tasks involving get overlap region get phenotype region get species binding matrix get track data. Combines 4 tools from 2 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/epigenomic_landscape",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/epigenomic_landscape",
  },
  {
    id: "experimental_data_processing",
    name: "experimental_data_processing",
    description:
      "Experimental Data Processing - Process experimental data: absolute error, mean square, max value, scientific notation formatting. Use this skill for experimental physics tasks involving calculate absolute error calculate mean square calculate max value format scientific notation convert to scientific notation. Combines 5 tools from 1 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/experimental_data_processing",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/experimental_data_processing",
  },
  {
    id: "fda-drug-risk-assessment",
    name: "fda-drug-risk-assessment",
    description:
      "Assess drug risks and adverse effects using FDA drug database to retrieve safety information and risk profiles.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/fda-drug-risk-assessment",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/fda-drug-risk-assessment",
  },
  {
    id: "full_protein_analysis",
    name: "full_protein_analysis",
    description:
      "Full Protein Characterization - Complete protein characterization: validate sequence, compute all properties, predict structure, and analyze pockets. Use this skill for protein biochemistry tasks involving is valid protein sequence analyze protein ComputeProtPara pred protein structure esmfold run fpocket. Combines 5 tools from 4 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/full_protein_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/full_protein_analysis",
  },
  {
    id: "functional_group_profiling",
    name: "functional_group_profiling",
    description:
      "Functional Group Profiling - Profile functional groups: radical assignment, H-bond analysis, aromaticity, and abbreviation condensation. Use this skill for organic chemistry tasks involving AssignRadicals GetHBANum AromaticityAnalyzer CondenseAbbreviationSubstanceGroups. Combines 4 tools from 2 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/functional_group_profiling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/functional_group_profiling",
  },
  {
    id: "gene_comprehensive_lookup",
    name: "gene_comprehensive_lookup",
    description:
      "Gene Comprehensive Lookup - Comprehensive gene lookup: NCBI gene data, Ensembl gene info, UniProt protein data, and KEGG pathway links. Use this skill for bioinformatics tasks involving get gene metadata by gene name get lookup symbol get general info by protein or gene name kegg find. Combines 4 tools from 4 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/gene_comprehensive_lookup",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/gene_comprehensive_lookup",
  },
  {
    id: "gene_disease_association",
    name: "gene_disease_association",
    description:
      "Gene-Disease Association Analysis - Analyze gene-disease associations: NCBI gene metadata, OpenTargets disease associations, TCGA expression, and Monarch phenotypes. Use this skill for medical genetics tasks involving get gene metadata by gene name get associated targets by disease efoId get gene expression across cancers get joint associated diseases by HPO ID list. Combines 4 tools from 4 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/gene_disease_association",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/gene_disease_association",
  },
  {
    id: "gene_expression_atlas",
    name: "gene_expression_atlas",
    description:
      "Gene Expression Atlas - Build gene expression atlas: TCGA cancer expression, NCBI gene info, Ensembl gene details, and literature search. Use this skill for transcriptomics tasks involving get gene expression across cancers get gene metadata by gene name get lookup symbol search literature. Combines 4 tools from 4 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/gene_expression_atlas",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/gene_expression_atlas",
  },
  {
    id: "gene_family_evolution",
    name: "gene_family_evolution",
    description:
      "Gene Family Evolution Analysis - Analyze gene family evolution: CAFE gene tree, homology, Ensembl gene tree, and taxonomy. Use this skill for molecular evolution tasks involving get cafe genetree member symbol get homology symbol get genetree member symbol get taxonomy classification. Combines 4 tools from 1 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/gene_family_evolution",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/gene_family_evolution",
  },
  {
    id: "gene_therapy_target",
    name: "gene_therapy_target",
    description:
      "Gene Therapy Target Analysis - Analyze gene therapy target: gene info, variant pathogenicity, protein structure, and clinical evidence. Use this skill for gene therapy tasks involving get gene metadata by gene name get vep hgvs Protein structure prediction ESMFold clinvar search. Combines 4 tools from 4 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/gene_therapy_target",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/gene_therapy_target",
  },
  {
    id: "gene_to_drug_pipeline",
    name: "gene_to_drug_pipeline",
    description:
      "Gene-to-Drug Discovery Pipeline - Full gene-to-drug pipeline: gene lookup, protein structure, binding pocket, virtual screening, and drug-likeness. Use this skill for translational medicine tasks involving get gene metadata by gene name pred protein structure esmfold run fpocket boltz binding affinity calculate mol drug chemistry. Combines 5 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/gene_to_drug_pipeline",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/gene_to_drug_pipeline",
  },
  {
    id: "gene_variant_drug_nexus",
    name: "gene_variant_drug_nexus",
    description:
      "Gene-Variant-Drug Nexus - Connect gene variants to drugs: variant effect, gene-disease link, drug associations, and clinical evidence. Use this skill for translational genomics tasks involving get vep hgvs get associated targets by disease efoId get associated drugs by target name clinvar search. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/gene_variant_drug_nexus",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/gene_variant_drug_nexus",
  },
  {
    id: "gene-knowledge-integration",
    name: "gene-knowledge-integration",
    description:
      "Given a gene symbol (e.g. TPMT), query 3 public databases (ClinGen CAR, PharmGKB, Monarch) to obtain gene registry info, FDA drug labels, clinical annotations, and gene-phenotype associations. Save all results into a JSON file.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/gene-knowledge-integration",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/gene-knowledge-integration",
  },
  {
    id: "genetic_counseling_report",
    name: "genetic_counseling_report",
    description:
      "Genetic Counseling Variant Report - Generate variant report for genetic counseling: VEP, ClinVar, gene phenotype, and literature evidence. Use this skill for clinical genetics tasks involving get vep hgvs clinvar search get phenotype gene pubmed search. Combines 4 tools from 2 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/genetic_counseling_report",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/genetic_counseling_report",
  },
  {
    id: "genome_annotation",
    name: "genome_annotation",
    description:
      "Genome Annotation Pipeline - Annotate a genome: NCBI annotation report, Ensembl gene lookup, UCSC tracks, and KEGG pathway links. Use this skill for genomics tasks involving get genome annotation report get lookup symbol list tracks kegg link. Combines 4 tools from 4 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/genome_annotation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/genome_annotation",
  },
  {
    id: "geometric-volume-calculation",
    name: "geometric-volume-calculation",
    description:
      "Calculate volumes of geometric shapes for engineering design and mathematical analysis.",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/geometric-volume-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/geometric-volume-calculation",
  },
  {
    id: "geometry_trigonometry",
    name: "geometry_trigonometry",
    description:
      "Geometry & Trigonometry Suite - Solve geometry problems: calculate area, height from sine, angle in degrees, and increase factor. Use this skill for mathematics tasks involving calculate area calculate height from length and sine calculate phi deg calculate increase factor. Combines 4 tools from 1 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/geometry_trigonometry",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/geometry_trigonometry",
  },
  {
    id: "go_term_analysis",
    name: "go_term_analysis",
    description:
      "Gene Ontology Analysis - Analyze GO terms: ChEMBL GO slim, STRING functional enrichment, STRING annotation, and Ensembl ontology. Use this skill for functional genomics tasks involving get go slim by id get functional enrichment get functional annotation get ontology name. Combines 4 tools from 3 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/go_term_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/go_term_analysis",
  },
  {
    id: "infectious_disease_analysis",
    name: "infectious_disease_analysis",
    description:
      "Infectious Disease Analysis - Analyze infectious disease: virus data, taxonomy, antimicrobial drugs, and resistance literature. Use this skill for infectious disease tasks involving get virus dataset report get taxonomy get mechanism of action by drug name pubmed search. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/infectious_disease_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/infectious_disease_analysis",
  },
  {
    id: "interproscan_pipeline",
    name: "interproscan_pipeline",
    description:
      "InterProScan Analysis Pipeline - Run InterProScan for domain analysis, then enrich with UniProt data and STRING interactions. Use this skill for functional proteomics tasks involving interproscan analyze get uniprotkb entry by accession get functional enrichment query interpro. Combines 4 tools from 4 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/interproscan_pipeline",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/interproscan_pipeline",
  },
  {
    id: "interproscan-domain-analysis",
    name: "interproscan-domain-analysis",
    description:
      "Analyze protein sequences using InterProScan to identify functional domains, protein families, and Gene Ontology (GO) annotations.",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/interproscan-domain-analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/interproscan-domain-analysis",
  },
  {
    id: "kegg-gene-search",
    name: "kegg-gene-search",
    description:
      "Search KEGG database for gene information to retrieve pathway associations, functional annotations, and disease links.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/kegg-gene-search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/kegg-gene-search",
  },
  {
    id: "lab_protocol_from_literature",
    name: "lab_protocol_from_literature",
    description:
      "Lab Protocol from Literature - Extract and generate lab protocol: search PubMed, extract protocol from paper, and generate executable protocol. Use this skill for lab science tasks involving pubmed search extract protocol from pdf protocol generation generate executable json. Combines 4 tools from 2 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/lab_protocol_from_literature",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/lab_protocol_from_literature",
  },
  {
    id: "lead_compound_optimization",
    name: "lead_compound_optimization",
    description:
      "Lead Compound Optimization - Optimize a lead compound: validate SMILES, compute drug-likeness, predict ADMET properties, and check ChEMBL bioactivity. Use this skill for medicinal chemistry tasks involving is valid smiles calculate mol drug chemistry pred molecule admet search activity. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/lead_compound_optimization",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/lead_compound_optimization",
  },
  {
    id: "length_measurement",
    name: "length_measurement",
    description:
      "Length & Dimension Measurement - Precision length measurement: convert mm to m, calculate length plus width, area, and error. Use this skill for metrology tasks involving convert length mm to m calculate length plus width calculate area calculate absolute error. Combines 4 tools from 3 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/length_measurement",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/length_measurement",
  },
  {
    id: "material-density-volume-calculation",
    name: "material-density-volume-calculation",
    description:
      "Calculate material density and volume from mass and geometric dimensions for materials mechanics analysis.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/material-density-volume-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/material-density-volume-calculation",
  },
  {
    id: "measurement-error-analysis",
    name: "measurement-error-analysis",
    description:
      "Analyze measurement errors, uncertainties, and statistical variations in experimental data for quality control.",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/measurement-error-analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/measurement-error-analysis",
  },
  {
    id: "meta-analysis-execution",
    name: "meta-analysis-execution",
    description:
      "Perform meta-analysis on scientific studies to synthesize research findings and generate comprehensive reports with statistical summaries.",
    categoryId: "lab-automation-literature-mining",
    sourcePath: "skills/meta-analysis-execution",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/meta-analysis-execution",
  },
  {
    id: "metabolomics_pathway",
    name: "metabolomics_pathway",
    description:
      "Metabolomics Pathway Analysis - Analyze metabolomics: compound identification, KEGG pathway mapping, enzyme links, and PubChem data. Use this skill for metabolomics tasks involving search pubchem by name kegg find kegg link kegg get. Combines 4 tools from 2 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/metabolomics_pathway",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/metabolomics_pathway",
  },
  {
    id: "microbiome_genomics",
    name: "microbiome_genomics",
    description:
      "Microbiome Genomics Analysis - Analyze microbial genome: NCBI genome data, taxonomy, KEGG metabolic pathways, and annotation. Use this skill for metagenomics tasks involving get genome dataset report by taxon get taxonomy kegg find get genome annotation report. Combines 4 tools from 2 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/microbiome_genomics",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/microbiome_genomics",
  },
  {
    id: "mobility_analysis",
    name: "mobility_analysis",
    description:
      "Charge Carrier Mobility Analysis - Analyze carrier mobility: calculate new mobility, compute vacuum permittivity, and error analysis. Use this skill for semiconductor physics tasks involving calculate new mobility calculate vacuum permittivity calculate absolute error calculate mean square. Combines 4 tools from 2 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/mobility_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/mobility_analysis",
  },
  {
    id: "molecular_docking_pipeline",
    name: "molecular_docking_pipeline",
    description:
      "Molecular Docking Pipeline - Complete docking workflow: retrieve protein structure, predict binding pockets, prepare receptor, and dock ligand. Use this skill for structural biology tasks involving retrieve protein data by pdbcode run fpocket convert pdb to pdbqt dock quick molecule docking. Combines 4 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/molecular_docking_pipeline",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/molecular_docking_pipeline",
  },
  {
    id: "molecular_fingerprint_analysis",
    name: "molecular_fingerprint_analysis",
    description:
      "Molecular Fingerprint Analysis - Fingerprint analysis: topology descriptors, structure complexity, similarity calculation, and AromaticityAnalysis. Use this skill for cheminformatics tasks involving calculate mol topology calculate mol structure complexity calculate smiles similarity AromaticityAnalyzer. Combines 4 tools from 2 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/molecular_fingerprint_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/molecular_fingerprint_analysis",
  },
  {
    id: "molecular_visualization_suite",
    name: "molecular_visualization_suite",
    description:
      "Molecular Visualization Suite - Visualize molecules: convert SMILES to formats, visualize molecule, visualize protein, visualize complex. Use this skill for chemical visualization tasks involving convert smiles to format visualize molecule visualize protein visualize complex. Combines 4 tools from 1 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/molecular_visualization_suite",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/molecular_visualization_suite",
  },
  {
    id: "molecular-descriptors-calculation",
    name: "molecular-descriptors-calculation",
    description:
      "Calculate advanced molecular descriptors including shape indices, connectivity indices, and structural features for QSAR and drug discovery.",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/molecular-descriptors-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/molecular-descriptors-calculation",
  },
  {
    id: "molecular-format-conversion",
    name: "molecular-format-conversion",
    description:
      "Convert between molecular formats including SMILES, InChI, InChIKey, and SELFIES for cheminformatics applications.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/molecular-format-conversion",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/molecular-format-conversion",
  },
  {
    id: "molecular-properties-calculation",
    name: "molecular-properties-calculation",
    description:
      "Calculate basic molecular properties from SMILES including molecular weight, formula, atom counts, and exact mass.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/molecular-properties-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/molecular-properties-calculation",
  },
  {
    id: "molecular-property-profiling",
    name: "molecular-property-profiling",
    description:
      "Comprehensive molecular property analysis covering basic info, hydrophobicity, H-bonding, structural complexity, topology, drug-likeness, charge distribution, and complexity metrics.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/molecular-property-profiling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/molecular-property-profiling",
  },
  {
    id: "molecular-similarity-search",
    name: "molecular-similarity-search",
    description:
      "Search for similar molecules using Tanimoto similarity with Morgan fingerprints to identify structurally related compounds.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/molecular-similarity-search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/molecular-similarity-search",
  },
  {
    id: "mouse_model_analysis",
    name: "mouse_model_analysis",
    description:
      "Mouse Model Disease Analysis - Analyze mouse disease models: MouseMine search, NCBI mouse gene data, Ensembl cross-species comparison, and orthologs. Use this skill for model organisms tasks involving mousemine search get gene metadata by gene name get homology symbol get gene orthologs. Combines 4 tools from 3 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/mouse_model_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/mouse_model_analysis",
  },
  {
    id: "multiomics_integration",
    name: "multiomics_integration",
    description:
      "Multi-Omics Integration - Integrate transcriptomics (TCGA), proteomics (UniProt), pathway enrichment (STRING), and metabolic pathway (KEGG) data for a target gene. Outputs a unified JSON report combining expression profiles, protein annotations, enriched pathways, and KEGG pathway details.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/multiomics_integration",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/multiomics_integration",
  },
  {
    id: "multispecies_gene_analysis",
    name: "multispecies_gene_analysis",
    description:
      "Multi-Species Gene Analysis - Analyze gene across species: Ensembl homologs, NCBI orthologs, cross-species STRING similarity, and taxonomy. Use this skill for comparative genomics tasks involving get homology symbol get gene orthologs get best similarity hits between species get taxonomy. Combines 4 tools from 3 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/multispecies_gene_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/multispecies_gene_analysis",
  },
  {
    id: "mutation_impact_analysis",
    name: "mutation_impact_analysis",
    description:
      "Mutation Impact Analysis - Analyze mutation impact: predict structure, predict mutations from sequence and structure, and check variant effects with Ensembl VEP. Use this skill for molecular biology tasks involving pred protein structure esmfold zero shot sequence prediction predict zero shot structure get vep hgvs. Combines 4 tools from 3 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/mutation_impact_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/mutation_impact_analysis",
  },
  {
    id: "natural_product_analysis",
    name: "natural_product_analysis",
    description:
      "Natural Product Analysis - Analyze natural products: name to SMILES, PubChem lookup, structural analysis, and KEGG natural product search. Use this skill for natural products chemistry tasks involving NameToSMILES search pubchem by name ChemicalStructureAnalyzer kegg find. Combines 4 tools from 4 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/natural_product_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/natural_product_analysis",
  },
  {
    id: "ncbi_gene_deep_dive",
    name: "ncbi_gene_deep_dive",
    description:
      "NCBI Gene Deep Dive - Deep dive into NCBI gene: metadata, dataset report, product report, orthologs, and gene links. Use this skill for gene biology tasks involving get gene metadata by gene name get gene dataset report by id get gene product report by id get gene orthologs get gene links by id. Combines 5 tools from 1 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/ncbi_gene_deep_dive",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/ncbi_gene_deep_dive",
  },
  {
    id: "ncbi-gene-retrieval",
    name: "ncbi-gene-retrieval",
    description:
      "Retrieve gene information from NCBI Gene database by gene IDs to obtain genomic details, function, and expression data.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/ncbi-gene-retrieval",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/ncbi-gene-retrieval",
  },
  {
    id: "nuclear_physics",
    name: "nuclear_physics",
    description:
      "Nuclear Physics Calculations - Nuclear physics: energy conversion MeV to J, calculate total power, photon rate, and error analysis. Use this skill for nuclear physics tasks involving convert energy MeV to J calculate total power calculate incident photon rate calculate absolute error. Combines 4 tools from 3 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/nuclear_physics",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/nuclear_physics",
  },
  {
    id: "oceanographic-seawater-properties",
    name: "oceanographic-seawater-properties",
    description:
      "Calculate seawater thermodynamic properties using TEOS-10 standard including density, salinity, sound speed, and freezing temperature for oceanography.",
    categoryId: "earth-environmental-science",
    sourcePath: "skills/oceanographic-seawater-properties",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/oceanographic-seawater-properties",
  },
  {
    id: "one_health_analysis",
    name: "one_health_analysis",
    description:
      "One Health Pathogen Analysis - One Health analysis: pathogen genome, cross-species gene comparison, antimicrobial drugs, and environmental context. Use this skill for one health tasks involving get genome dataset report by taxon get homology symbol get mechanism of action by drug name tavily search get taxonomy. Combines 5 tools from 4 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/one_health_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/one_health_analysis",
  },
  {
    id: "opentargets-disease-target",
    name: "opentargets-disease-target",
    description:
      "Retrieve disease-associated targets from Open Targets using disease EFO IDs to identify therapeutic targets.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/opentargets-disease-target",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/opentargets-disease-target",
  },
  {
    id: "optical-frequency-calculation",
    name: "optical-frequency-calculation",
    description:
      "Calculate optical frequency and wavelength relationships for photonics and electromagnetic analysis.",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/optical-frequency-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/optical-frequency-calculation",
  },
  {
    id: "optics_analysis",
    name: "optics_analysis",
    description:
      "Optical System Analysis - Analyze optical system: calculate photon rate, frequency range, radiation pressure, and electron wavelength. Use this skill for optics tasks involving calculate incident photon rate calculate frequency range calculate radiation pressure electron wavelength. Combines 4 tools from 1 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/optics_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/optics_analysis",
  },
  {
    id: "organism_classification",
    name: "organism_classification",
    description:
      "Organism Classification & Database - Classify organism: NCBI taxonomy, Ensembl taxonomy, ChEMBL organisms, and genome info. Use this skill for taxonomy tasks involving get taxonomy get taxonomy id get organism by id get genome dataset report by taxon. Combines 4 tools from 3 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/organism_classification",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/organism_classification",
  },
  {
    id: "orphan_drug_analysis",
    name: "orphan_drug_analysis",
    description:
      "Orphan Drug & Rare Disease Analysis - Analyze orphan drugs: Monarch disease phenotypes, OpenTargets targets, FDA drug data, and clinical studies. Use this skill for orphan drug development tasks involving get joint associated diseases by HPO ID list get associated targets by disease efoId get clinical studies info by drug name pubmed search. Combines 4 tools from 4 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/orphan_drug_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/orphan_drug_analysis",
  },
  {
    id: "pandemic_preparedness",
    name: "pandemic_preparedness",
    description:
      "Pandemic Preparedness Analysis - Pandemic analysis: virus genome, taxonomy, drug candidates, and literature intelligence. Use this skill for public health tasks involving get virus dataset report get virus by taxon genome get mechanism of action by drug name tavily search search literature. Combines 5 tools from 4 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/pandemic_preparedness",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/pandemic_preparedness",
  },
  {
    id: "pediatric_drug_safety",
    name: "pediatric_drug_safety",
    description:
      "Pediatric Drug Safety Review - Evaluate pediatric drug safety: pediatric use info, child safety, dosage forms, and overdosage info from FDA. Use this skill for pediatric pharmacology tasks involving get pediatric use info by drug name get child safety info by drug name get dosage forms and strengths by drug name get overdosage info by drug name. Combines 4 tools from 1 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/pediatric_drug_safety",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/pediatric_drug_safety",
  },
  {
    id: "peptide-properties-calculation",
    name: "peptide-properties-calculation",
    description:
      "Calculate peptide sequence properties including molecular weight, isoelectric point, extinction coefficient, and chemical formula.",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/peptide-properties-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/peptide-properties-calculation",
  },
  {
    id: "personalized_medicine",
    name: "personalized_medicine",
    description:
      "Personalized Medicine Report - Generate personalized medicine report: pharmacogenomics, variant effects, drug safety, and clinical pharmacology. Use this skill for precision medicine tasks involving get pharmacogenomics info by drug name get vep hgvs get adverse reactions by drug name get clinical pharmacology by drug name. Combines 4 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/personalized_medicine",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/personalized_medicine",
  },
  {
    id: "pharmacogenomics_analysis",
    name: "pharmacogenomics_analysis",
    description:
      "Pharmacogenomics Analysis - Pharmacogenomics analysis: FDA pharmacogenomics info, variant effects, ClinVar pathogenicity, and gene expression. Use this skill for pharmacogenomics tasks involving get pharmacogenomics info by drug name get vep hgvs clinvar search get gene expression across cancers. Combines 4 tools from 4 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/pharmacogenomics_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/pharmacogenomics_analysis",
  },
  {
    id: "pharmacokinetics_profile",
    name: "pharmacokinetics_profile",
    description:
      "Pharmacokinetics Profile Builder - Build a PK profile: FDA pharmacokinetics, clinical pharmacology, dosage info, and molecular properties. Use this skill for pharmacology tasks involving get pharmacokinetics by drug name get clinical pharmacology by drug name get dosage and storage information by drug name get compound by name. Combines 4 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/pharmacokinetics_profile",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/pharmacokinetics_profile",
  },
  {
    id: "phenotype-by-hpo-id",
    name: "phenotype-by-hpo-id",
    description:
      "Retrieve phenotype information from Monarch Initiative using HPO (Human Phenotype Ontology) IDs to understand disease manifestations.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/phenotype-by-hpo-id",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/phenotype-by-hpo-id",
  },
  {
    id: "polymer_property_analysis",
    name: "polymer_property_analysis",
    description:
      "Polymer & Material Property Analysis - Analyze polymer properties: composition, symmetry, density, and lattice parameters for material design. Use this skill for polymer science tasks involving MaterialCompositionAnalyzer CalculateSymmetry CalculateDensity MofLattice. Combines 4 tools from 2 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/polymer_property_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/polymer_property_analysis",
  },
  {
    id: "polypharmacology_analysis",
    name: "polypharmacology_analysis",
    description:
      "Polypharmacology Analysis - Analyze a drug's multi-target pharmacology: get targets from ChEMBL, functional enrichment from STRING, and pathway links from KEGG. Use this skill for pharmacology tasks involving get target by name get functional enrichment kegg link get mechanism by id. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/polypharmacology_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/polypharmacology_analysis",
  },
  {
    id: "population_genetics",
    name: "population_genetics",
    description:
      "Population Genetics Analysis - Analyze population genetics: Ensembl variation populations, linkage disequilibrium, and variant frequency data. Use this skill for population genetics tasks involving get info variation populations get ld get variation get variant recoder. Combines 4 tools from 1 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/population_genetics",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/population_genetics",
  },
  {
    id: "precision_oncology",
    name: "precision_oncology",
    description:
      "Precision Oncology Workflow - Precision oncology: tumor expression profiling, variant analysis, targeted therapy lookup, and clinical trials. Use this skill for precision oncology tasks involving get gene expression across cancers get vep hgvs get associated drugs by target name get clinical studies info by drug name pubmed search. Combines 5 tools from 5 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/precision_oncology",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/precision_oncology",
  },
  {
    id: "protein_classification_analysis",
    name: "protein_classification_analysis",
    description:
      "Protein Classification Analysis - Classify protein: ChEMBL protein classification, UniProt entry, InterPro domains, and Ensembl biotypes. Use this skill for protein science tasks involving search protein classification get uniprotkb entry by accession query interpro get info biotypes. Combines 4 tools from 4 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_classification_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_classification_analysis",
  },
  {
    id: "protein_complex_analysis",
    name: "protein_complex_analysis",
    description:
      "Protein Complex Visualization & Analysis - Analyze protein complex: download structure, visualize complex, extract chains, and calculate quality metrics. Use this skill for structural biology tasks involving retrieve protein data by pdbcode visualize complex extract pdb chains calculate pdb basic info. Combines 4 tools from 1 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_complex_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_complex_analysis",
  },
  {
    id: "protein_database_crossref",
    name: "protein_database_crossref",
    description:
      "Protein Cross-Database Reference - Cross-reference protein: UniProt entry, NCBI gene, Ensembl xrefs, and PDB structure search. Use this skill for proteomics tasks involving get uniprotkb entry by accession get gene metadata by gene name get xrefs symbol retrieve protein data by pdbcode. Combines 4 tools from 4 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_database_crossref",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_database_crossref",
  },
  {
    id: "protein_drug_interaction",
    name: "protein_drug_interaction",
    description:
      "Protein-Drug Interaction Profiling - Profile protein-drug interactions: protein properties, drug structure, binding affinity prediction, and interaction data. Use this skill for molecular pharmacology tasks involving calculate protein sequence properties ChemicalStructureAnalyzer boltz binding affinity PredictDrugTargetInteraction. Combines 4 tools from 4 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/protein_drug_interaction",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_drug_interaction",
  },
  {
    id: "protein_engineering",
    name: "protein_engineering",
    description:
      "Protein Engineering Workflow - Engineer a protein: predict structure, identify functional residues, predict beneficial mutations, and calculate properties. Use this skill for protein engineering tasks involving Protein structure prediction ESMFold predict functional residue zero shot sequence prediction calculate protein sequence properties. Combines 4 tools from 2 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_engineering",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_engineering",
  },
  {
    id: "protein_function_annotation",
    name: "protein_function_annotation",
    description:
      "Protein Function Annotation Pipeline - Annotate protein function: UniProt metadata, InterPro domains, functional prediction, and GO enrichment. Use this skill for proteomics tasks involving query uniprot query interpro predict protein function get functional enrichment. Combines 4 tools from 2 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_function_annotation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_function_annotation",
  },
  {
    id: "protein_interaction_network",
    name: "protein_interaction_network",
    description:
      "Protein Interaction Network Analysis - Build protein interaction network: map identifiers with STRING, get PPI network, compute enrichment, and link to KEGG pathways. Use this skill for systems biology tasks involving mapping identifiers get string network interaction get ppi enrichment kegg link. Combines 4 tools from 2 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_interaction_network",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_interaction_network",
  },
  {
    id: "protein_property_comparison",
    name: "protein_property_comparison",
    description:
      "Cross-Species Protein Comparison - Compare proteins across species: get orthologs from NCBI, compute properties for each, and compare similarity. Use this skill for comparative biology tasks involving get gene orthologs calculate protein sequence properties calculate smiles similarity get homology id. Combines 4 tools from 3 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_property_comparison",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_property_comparison",
  },
  {
    id: "protein_quality_assessment",
    name: "protein_quality_assessment",
    description:
      "Protein Structure Quality Assessment - Assess structure quality: basic info, geometry analysis, quality metrics, composition, and visualization. Use this skill for structural biology tasks involving calculate pdb basic info calculate pdb structural geometry calculate pdb quality metrics calculate pdb composition info visualize protein. Combines 5 tools from 1 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_quality_assessment",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_quality_assessment",
  },
  {
    id: "protein_similarity_search",
    name: "protein_similarity_search",
    description:
      "Protein Similarity Search - Search for similar proteins: extract sequence from PDB, search structures with FoldSeek, find homologs with STRING, and check UniProt. Use this skill for bioinformatics tasks involving extract pdb sequence foldseek search get best similarity hits between species search uniprotkb entries. Combines 4 tools from 3 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_similarity_search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_similarity_search",
  },
  {
    id: "protein_solubility_optimization",
    name: "protein_solubility_optimization",
    description:
      "Protein Solubility Optimization - Optimize protein solubility: calculate properties, predict solubility, predict hydrophilicity, and suggest mutations. Use this skill for protein engineering tasks involving calculate protein sequence properties predict protein function ComputeHydrophilicity zero shot sequence prediction. Combines 4 tools from 3 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_solubility_optimization",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_solubility_optimization",
  },
  {
    id: "protein_structure_analysis",
    name: "protein_structure_analysis",
    description:
      "Protein Structure Comprehensive Analysis - Comprehensive structure analysis: download PDB, extract chains, calculate geometry, quality metrics, and composition. Use this skill for structural biology tasks involving retrieve protein data by pdbcode extract pdb chains calculate pdb structural geometry calculate pdb quality metrics calculate pdb composition info. Combines 5 tools from 1 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein_structure_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein_structure_analysis",
  },
  {
    id: "protein-blast-search",
    name: "protein-blast-search",
    description:
      "Search for similar protein sequences in UniProt Swiss-Prot database using BLAST to identify homologous proteins and functional relationships.",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein-blast-search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein-blast-search",
  },
  {
    id: "protein-properties-calculation",
    name: "protein-properties-calculation",
    description:
      "Calculate comprehensive protein sequence properties including isoelectric point, molecular weight, hydrophobicity, and physicochemical parameters.",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/protein-properties-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protein-properties-calculation",
  },
  {
    id: "proteome_analysis",
    name: "proteome_analysis",
    description:
      "Proteome-Level Analysis - Analyze at proteome level: get proteome from UniProt, gene-centric view, functional annotation from STRING. Use this skill for proteomics tasks involving get proteome by id get gene centric by proteome get functional annotation. Combines 3 tools from 2 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/proteome_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/proteome_analysis",
  },
  {
    id: "protocol-extraction-from-pdf",
    name: "protocol-extraction-from-pdf",
    description:
      "Extract laboratory protocols from PDF documents using Thoth-Plan to convert experimental procedures into structured text.",
    categoryId: "lab-automation-literature-mining",
    sourcePath: "skills/protocol-extraction-from-pdf",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protocol-extraction-from-pdf",
  },
  {
    id: "protocol-generation",
    name: "protocol-generation-from-description",
    description:
      "Generate detailed laboratory protocols from natural language descriptions using AI, producing step-by-step experimental procedures ready for lab execution.",
    categoryId: "lab-automation-literature-mining",
    sourcePath: "skills/protocol-generation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protocol-generation",
  },
  {
    id: "protocol-to-executable-json",
    name: "protocol-to-executable-json",
    description:
      "Convert laboratory protocols to executable JSON format using Thoth-OP for automated lab equipment control.",
    categoryId: "lab-automation-literature-mining",
    sourcePath: "skills/protocol-to-executable-json",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/protocol-to-executable-json",
  },
  {
    id: "pubchem_deep_dive",
    name: "pubchem_deep_dive",
    description:
      "PubChem Deep Dive Analysis - Deep dive into PubChem: compound info, bioassay summary, 3D conformers, synonyms, and general description. Use this skill for chemical databases tasks involving get pubchem compound by cid get assay summary by cid get conformers by cid get compound synonyms by name get general info by compound name. Combines 5 tools from 1 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/pubchem_deep_dive",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/pubchem_deep_dive",
  },
  {
    id: "pubchem-smiles-search",
    name: "pubchem-smiles-search",
    description:
      "Search PubChem database using SMILES strings to retrieve compound information and chemical properties.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/pubchem-smiles-search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/pubchem-smiles-search",
  },
  {
    id: "pubmed-article-search",
    name: "pubmed-article-search",
    description:
      "Search PubMed database for scientific articles and publications to retrieve biomedical literature.",
    categoryId: "lab-automation-literature-mining",
    sourcePath: "skills/pubmed-article-search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/pubmed-article-search",
  },
  {
    id: "rare_disease_genetics",
    name: "rare_disease_genetics",
    description:
      "Rare Disease Genetic Analysis - Analyze rare disease genetics: Monarch phenotype-disease mapping, ClinVar variants, NCBI gene data, and OpenTargets. Use this skill for rare disease genetics tasks involving get HPO ID by phenotype get joint associated diseases by HPO ID list clinvar search get associated targets by disease efoId. Combines 4 tools from 3 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/rare_disease_genetics",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/rare_disease_genetics",
  },
  {
    id: "region-gene-elements",
    name: "region-gene-elements",
    description:
      "Query IGVF Catalog for regulatory element–gene associations within a genomic region, including association scores, element types, and biosample context.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/region-gene-elements",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/region-gene-elements",
  },
  {
    id: "regulatory_region_analysis",
    name: "regulatory_region_analysis",
    description:
      "Regulatory Region Analysis - Analyze regulatory regions: get overlapping features, binding matrix, sequence, and phenotype associations. Use this skill for epigenomics tasks involving get overlap region get species binding matrix get sequence get phenotype region. Combines 4 tools from 2 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/regulatory_region_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/regulatory_region_analysis",
  },
  {
    id: "scientific-literature-search",
    name: "scientific-literature-search",
    description:
      "Search scientific literature and research papers using FlowSearch to find relevant academic articles and publications.",
    categoryId: "lab-automation-literature-mining",
    sourcePath: "skills/scientific-literature-search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/scientific-literature-search",
  },
  {
    id: "sciverse-academic-retrieval",
    name: "sciverse-academic-retrieval",
    description:
      "Citation-grade academic literature retrieval (search, semantic chunks, byte-range read, figure fetch) over Sciverse, an open scientific platform indexing peer-reviewed and preprint papers.",
    categoryId: "lab-automation-literature-mining",
    sourcePath: "skills/sciverse-academic-retrieval",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/sciverse-academic-retrieval",
  },
  {
    id: "seawater-freezing-temperature",
    name: "seawater-freezing-temperature",
    description:
      "Calculate the freezing point temperature of seawater from absolute salinity and pressure using GSW thermodynamic equations.",
    categoryId: "earth-environmental-science",
    sourcePath: "skills/seawater-freezing-temperature",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/seawater-freezing-temperature",
  },
  {
    id: "seawater-sound-speed-calculation",
    name: "seawater-sound-speed-calculation",
    description:
      "Calculate sound speed in seawater from practical salinity, temperature, and pressure using the Gibbs Seawater Oceanographic Toolbox.",
    categoryId: "earth-environmental-science",
    sourcePath: "skills/seawater-sound-speed-calculation",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/seawater-sound-speed-calculation",
  },
  {
    id: "seismic-waveform-processing",
    name: "seismic-waveform-processing",
    description:
      "Process seismic waveform data including reading MinISEED/SAC files, extracting metadata, and visualizing earthquake signals.",
    categoryId: "other-scientific-computing",
    sourcePath: "skills/seismic-waveform-processing",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/seismic-waveform-processing",
  },
  {
    id: "signal_processing",
    name: "signal_processing",
    description:
      "Signal Processing Analysis - Analyze signals: duty cycle, frequency range, electron wavelength, and measurement error analysis. Use this skill for signal processing tasks involving calculate duty cycle calculate frequency range electron wavelength calculate absolute error. Combines 4 tools from 3 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/signal_processing",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/signal_processing",
  },
  {
    id: "smiles_comprehensive_analysis",
    name: "smiles_comprehensive_analysis",
    description:
      "SMILES Comprehensive Analysis - Comprehensive SMILES analysis: validate, convert name, compute all molecular descriptors, and predict ADMET. Use this skill for cheminformatics tasks involving is valid smiles ChemicalStructureAnalyzer calculate mol basic info pred molecule admet. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/smiles_comprehensive_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/smiles_comprehensive_analysis",
  },
  {
    id: "smiles-to-cas-conversion",
    name: "smiles-to-cas-conversion",
    description:
      "Convert SMILES strings to CAS registry numbers using material informatics tools to identify chemical substances.",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/smiles-to-cas-conversion",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/smiles-to-cas-conversion",
  },
  {
    id: "snp_functional_analysis",
    name: "snp_functional_analysis",
    description:
      "SNP Functional Impact Analysis - Analyze SNP function: VEP prediction, variation details, phenotype association, and literature evidence. Use this skill for functional genomics tasks involving get vep id get variation get phenotype accession pubmed search. Combines 4 tools from 2 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/snp_functional_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/snp_functional_analysis",
  },
  {
    id: "statistical_error_analysis",
    name: "statistical_error_analysis",
    description:
      "Statistical Error Analysis - Analyze measurement errors: absolute error, scientific notation, max value, mean square, and formatting. Use this skill for statistics tasks involving calculate absolute error convert to scientific notation calculate max value calculate mean square format scientific notation. Combines 5 tools from 1 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/statistical_error_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/statistical_error_analysis",
  },
  {
    id: "string-ppi-enrichment",
    name: "string-ppi-enrichment",
    description:
      "Analyze protein-protein interaction enrichment using STRING database to identify functional networks and pathway associations.",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/string-ppi-enrichment",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/string-ppi-enrichment",
  },
  {
    id: "structural_homology_modeling",
    name: "structural_homology_modeling",
    description:
      "Structural Homology & Evolution Analysis - Analyze protein evolution: get gene tree from Ensembl, find homologs, compare sequences, and predict structure. Use this skill for evolutionary biology tasks involving get homology symbol get genetree member symbol calculate protein sequence properties pred protein structure esmfold. Combines 4 tools from 3 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/structural_homology_modeling",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/structural_homology_modeling",
  },
  {
    id: "structural_pharmacogenomics",
    name: "structural_pharmacogenomics",
    description:
      "Structural Pharmacogenomics - Link structure to pharmacogenomics: variant effect, protein structure change, drug binding, and clinical data. Use this skill for pharmacogenomics tasks involving get vep hgvs pred protein structure esmfold boltz binding affinity get pharmacogenomics info by drug name. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/structural_pharmacogenomics",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/structural_pharmacogenomics",
  },
  {
    id: "substance_toxicology",
    name: "substance_toxicology",
    description:
      "Substance Toxicology Report - Toxicology report: PubChem substance data, FDA toxicology, carcinogenicity data, and environmental warnings. Use this skill for toxicology tasks involving get substance by name get nonclinical toxicology info by drug name get carcinogenic mutagenic fertility impairment info by drug name get environmental warning by drug name. Combines 4 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/substance_toxicology",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/substance_toxicology",
  },
  {
    id: "substructure_activity_search",
    name: "substructure_activity_search",
    description:
      "Substructure-Activity Relationship - Analyze substructure-activity: ChEMBL substructure search, activity data, PubChem compounds, and similarity. Use this skill for medicinal chemistry tasks involving get substructure by smiles search activity search pubchem by smiles calculate smiles similarity. Combines 4 tools from 3 SCP server(s).",
    categoryId: "chemistry-molecular-science",
    sourcePath: "skills/substructure_activity_search",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/substructure_activity_search",
  },
  {
    id: "synthetic_biology_design",
    name: "synthetic_biology_design",
    description:
      "Synthetic Biology Design - Design synthetic biology construct: gene lookup, codon optimization, protein property prediction, and structure prediction. Use this skill for synthetic biology tasks involving get sequence id DegenerateCodonCalculatorbyAminoAcid calculate protein sequence properties pred protein structure esmfold. Combines 4 tools from 4 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/synthetic_biology_design",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/synthetic_biology_design",
  },
  {
    id: "systems_pharmacology",
    name: "systems_pharmacology",
    description:
      "Systems Pharmacology Analysis - Systems pharmacology: drug targets, protein interactions, pathway enrichment, and gene expression. Use this skill for systems pharmacology tasks involving get target by name get string network interaction get functional enrichment get gene expression across cancers. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/systems_pharmacology",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/systems_pharmacology",
  },
  {
    id: "tcga-gene-expression",
    name: "tcga-gene-expression",
    description:
      "Retrieve gene expression data from TCGA (The Cancer Genome Atlas) to analyze cancer-specific expression patterns.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/tcga-gene-expression",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/tcga-gene-expression",
  },
  {
    id: "thermal_analysis",
    name: "thermal_analysis",
    description:
      "Thermal & Heat Transfer Analysis - Analyze thermal system: calculate heat released, convert energy units, compute potential energy, and dynamic viscosity. Use this skill for thermal engineering tasks involving calculate heat released convert energy MeV to J calculate potential energy calculate dynamic viscosity. Combines 4 tools from 1 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/thermal_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/thermal_analysis",
  },
  {
    id: "tissue_specific_analysis",
    name: "tissue_specific_analysis",
    description:
      "Tissue-Specific Expression Analysis - Analyze tissue-specific expression: ChEMBL tissue data, TCGA cancer expression, Ensembl gene info, and NCBI gene data. Use this skill for tissue biology tasks involving get tissue by id get gene expression across cancers get lookup symbol get gene metadata by gene name. Combines 4 tools from 4 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/tissue_specific_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/tissue_specific_analysis",
  },
  {
    id: "toxicity_assessment",
    name: "toxicity_assessment",
    description:
      "Drug Toxicity Assessment - Comprehensive toxicity assessment: FDA adverse reactions, nonclinical toxicology, carcinogenicity data, and ADMET prediction. Use this skill for toxicology tasks involving get adverse reactions by drug name get nonclinical toxicology info by drug name get carcinogenic mutagenic fertility impairment info by drug name pred molecule admet. Combines 4 tools from 2 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/toxicity_assessment",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/toxicity_assessment",
  },
  {
    id: "transcriptome_analysis",
    name: "transcriptome_analysis",
    description:
      "Transcriptome Analysis Pipeline - Analyze transcriptome: Ensembl transcript lookup, sequence retrieval, haplotype analysis, and UCSC track data. Use this skill for transcriptomics tasks involving get lookup id get sequence id get transcript haplotypes get track data. Combines 4 tools from 2 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/transcriptome_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/transcriptome_analysis",
  },
  {
    id: "ucsc_genome_exploration",
    name: "ucsc_genome_exploration",
    description:
      "UCSC Genome Browser Exploration - Explore genome via UCSC: list genomes, list tracks, get sequence, get track data, and cytoband info. Use this skill for genomics tasks involving list genomes list tracks get sequence get track data get cytoband. Combines 5 tools from 1 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/ucsc_genome_exploration",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/ucsc_genome_exploration",
  },
  {
    id: "uniprot_deep_analysis",
    name: "uniprot_deep_analysis",
    description:
      "UniProt Deep Protein Analysis - Deep UniProt analysis: entry data, UniRef clusters, UniParc cross-references, and gene-centric view. Use this skill for protein science tasks involving get uniprotkb entry by accession get uniref cluster by id get uniparc entry by upi get gene centric by accession. Combines 4 tools from 1 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/uniprot_deep_analysis",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/uniprot_deep_analysis",
  },
  {
    id: "uniprot-protein-retrieval",
    name: "uniprot-protein-retrieval",
    description:
      "Retrieve protein sequences and functional information from UniProt database by protein name, enabling protein analysis and bioinformatics workflows.",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/uniprot-protein-retrieval",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/uniprot-protein-retrieval",
  },
  {
    id: "unit_conversion_suite",
    name: "unit_conversion_suite",
    description:
      "Multi-Unit Conversion Suite - Convert units across domains: length mm to m, radius m to cm, dimensions to meters, nm to um, volume to cm3. Use this skill for metrology tasks involving convert length mm to m convert radius m to cm convert dimensions to meters convert nm to um convert volume to cm3. Combines 5 tools from 1 SCP server(s).",
    categoryId: "physics-engineering-computing",
    sourcePath: "skills/unit_conversion_suite",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/unit_conversion_suite",
  },
  {
    id: "unit-conversion-nanoscale",
    name: "unit-conversion-nanoscale",
    description:
      "Convert physical quantities and units at nanoscale for materials science and nanotechnology applications.",
    categoryId: "other-scientific-computing",
    sourcePath: "skills/unit-conversion-nanoscale",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/unit-conversion-nanoscale",
  },
  {
    id: "variant_pathogenicity",
    name: "variant_pathogenicity",
    description:
      "Variant Pathogenicity Assessment - Assess variant pathogenicity: Ensembl VEP prediction, ClinVar lookup, variation details, and gene phenotype associations. Use this skill for clinical genetics tasks involving get vep hgvs clinvar search get variation get phenotype gene. Combines 4 tools from 2 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/variant_pathogenicity",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/variant_pathogenicity",
  },
  {
    id: "variant-clinical-significance",
    name: "variant-clinical-significance",
    description:
      "Query NCBI ClinVar for variant clinical pathogenicity classification (Pathogenic/Benign/VUS), review status and associated diseases.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/variant-clinical-significance",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/variant-clinical-significance",
  },
  {
    id: "variant-cross-database-ids",
    name: "variant-cross-database-ids",
    description:
      "Query ClinGen Allele Registry to map variant rsID to identifiers in other databases (ClinVar, gnomAD, COSMIC, UniProtKB, OMIM, etc.).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/variant-cross-database-ids",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/variant-cross-database-ids",
  },
  {
    id: "variant-functional-prediction",
    name: "variant-functional-prediction",
    description:
      "Query FAVOR API for variant functional prediction scores (CADD, SIFT, PolyPhen, REVEL, etc.) and gene annotation.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/variant-functional-prediction",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/variant-functional-prediction",
  },
  {
    id: "variant-genomic-location",
    name: "variant-genomic-location",
    description:
      "Query dbSNP + NCBI Gene to get variant genomic position (chromosome, coordinates, ref/alt alleles, mutation type) and associated gene coordinates.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/variant-genomic-location",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/variant-genomic-location",
  },
  {
    id: "variant-gwas-associations",
    name: "variant-gwas-associations",
    description:
      "Query EBI GWAS Catalog for GWAS statistical associations (p-value, effect size, risk allele) between a variant and traits/diseases.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/variant-gwas-associations",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/variant-gwas-associations",
  },
  {
    id: "variant-pharmacogenomics",
    name: "variant-pharmacogenomics",
    description:
      "Query PharmGKB (clinPGx) for pharmacogenomic clinical annotations — how a variant affects drug response, dosing, and adverse reactions.",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/variant-pharmacogenomics",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/variant-pharmacogenomics",
  },
  {
    id: "variant-population-frequency",
    name: "variant-population-frequency",
    description:
      "Query gnomAD for variant allele frequency across populations. Uses FAVOR to convert rsID→variant_id first, then queries gnomAD.",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/variant-population-frequency",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/variant-population-frequency",
  },
  {
    id: "virtual_screening",
    name: "virtual_screening",
    description:
      "Virtual Screening Pipeline - Virtual screening: search PubChem by substructure, compute similarity, filter by drug-likeness, and predict binding affinity. Use this skill for drug discovery tasks involving search pubchem by smiles calculate smiles similarity calculate mol drug chemistry boltz binding affinity. Combines 4 tools from 3 SCP server(s).",
    categoryId: "drug-discovery-pharmacology",
    sourcePath: "skills/virtual_screening",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/virtual_screening",
  },
  {
    id: "virus_genomics",
    name: "virus_genomics",
    description:
      "Virus Genomics Analysis - Analyze virus genomics: NCBI virus dataset, annotation, taxonomy, and literature search. Use this skill for virology tasks involving get virus dataset report get virus annotation report get taxonomy search literature. Combines 4 tools from 2 SCP server(s).",
    categoryId: "genomics-genetic-analysis",
    sourcePath: "skills/virus_genomics",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/virus_genomics",
  },
  {
    id: "web_literature_mining",
    name: "web_literature_mining",
    description:
      "Scientific Literature Mining - Mine scientific literature: PubMed search, arXiv search, web search, and Tavily deep search. Use this skill for scientific informatics tasks involving pubmed search search literature search web tavily search. Combines 4 tools from 2 SCP server(s).",
    categoryId: "protein-science-engineering",
    sourcePath: "skills/web_literature_mining",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/web_literature_mining",
  },
  {
    id: "wind-site-assessment",
    name: "wind-site-assessment",
    description:
      "Assess wind energy potential and perform site analysis using atmospheric science calculations.",
    categoryId: "earth-environmental-science",
    sourcePath: "skills/wind-site-assessment",
    installUrl:
      "https://github.com/InternScience/scp/tree/cea5398564032aea65a78e246d06c30ae945e03f/skills/wind-site-assessment",
  },
] satisfies readonly ScienceSkillSnapshot[];
