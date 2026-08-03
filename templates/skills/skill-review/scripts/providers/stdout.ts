import type { Provider } from "./provider.js";

export const stdoutProvider: Provider = {
  name: "stdout",

  async postComments(report: string, _files: string[]) {
    console.log(report);
    return { posted: 0, errors: [] };
  },
};
