export interface Provider {
  name: string;
  postComments(
    report: string,
    files: string[],
  ): Promise<{ posted: number; errors: string[] }>;
}
