declare module "read-cmd-shim" {
  const readCmdShim: { sync(path: string): string };
  export default readCmdShim;
}

declare module "which" {
  const which: { sync(command: string, options?: { path?: string }): string };
  export default which;
}