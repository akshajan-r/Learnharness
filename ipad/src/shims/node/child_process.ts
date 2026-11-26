/** node:child_process on iPad: programs run on the laptop bridge
 *  (src/bridge/remote-spawn.ts); the rest is unavailable. */
import { exec, execFile, fork } from "./misc.ts";
import { spawn } from "../../bridge/remote-spawn.ts";

export { spawn, exec, execFile, fork };
export default { spawn, exec, execFile, fork };
