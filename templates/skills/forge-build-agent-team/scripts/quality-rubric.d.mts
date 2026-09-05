export interface QualityDirectories {
  hasRefsDirOnDisk?: boolean;
  hasAssetsDirOnDisk?: boolean;
  hasScriptsDirOnDisk?: boolean;
}

export declare const QUALITY_AXES: readonly {
  key: string;
  label: string;
}[];

export declare function scoreSkill(text: string, directories?: QualityDirectories): Record<string, number>;
export declare function checkSkillStructure(options: {
  name: string;
  parentDir: string;
  rawFrontmatter: Record<string, unknown>;
  text: string;
  resolveReference?: (reference: string) => boolean;
}): string[];
