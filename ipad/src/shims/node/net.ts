import { isIP, BlockList } from "./misc.ts";
export { isIP, BlockList };
export const isIPv4 = (s: string) => isIP(s) === 4;
export const isIPv6 = (s: string) => isIP(s) === 6;
export default { isIP, isIPv4, isIPv6, BlockList };
