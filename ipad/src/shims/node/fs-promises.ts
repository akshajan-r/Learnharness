import fs from "./fs.ts";

const promises = fs.promises;
export default promises;

export const {
	access,
	appendFile,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	rmdir,
	stat,
	unlink,
	writeFile,
} = promises;
