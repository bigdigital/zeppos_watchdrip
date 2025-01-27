const deviceID = hmSetting.getDeviceInfo().deviceName;
export const isMiBand7 = deviceID === "Xiaomi Smart Band 7";

export class Path {
    constructor(scope, path, appid = 0) {
        this.localFS = false
        try {
            const systemInfo = hmSetting.getSystemInfo();
            if (Number(systemInfo.osVersion) >= 3){
                this.localFS = true;
                path = path.substring(path.lastIndexOf('/') + 1);
                scope = "data";
            }
            else {
                if(path[0] !== "/") path = "/" + path;
            }
        } catch (e) {

        }

        this.scope = scope;
        this.path = path;
        this.appid = appid;

        if (scope === "assets") {
            this.relativePath = path;
            this.absolutePath = FsTools.fullAssetPath(path);
        } else if (scope === "data") {
            this.relativePath = path;
            this.absolutePath = FsTools.fullDataPath(path);
        } else if (scope === "full") {
            this.relativePath = `../../../${path.substring(9)}`;
            if (this.relativePath.endsWith("/"))
                this.relativePath = this.relativePath.substring(0, this.relativePath.length - 1);
            this.absolutePath = path;
        } else {
            throw new Error("Unknown scope provided")
        }
    }

    get(path) {
        const newPath = this.path === "/" ? path : `${this.path}/${path}`;
        return new Path(this.scope, newPath);
    }

    resolve() {
        return new Path("full", this.absolutePath);
    }

    src() {
        if (this.scope !== "assets")
            throw new Error("Can't get src for non-asset");
        return this.relativePath.substring(1);
    }

    stat() {
        if (this.scope == "data") {
            if (this.appid) {
                return hmFS.stat(this.relativePath, {appid: this.appid});
            }
            else {
                return hmFS.stat(this.relativePath);
            }
        } else {
            return hmFS.stat_asset(this.relativePath);
        }
    }

    size() {
        const [st, e] = this.stat();
        if (st.size) {
            // Is file, nothing to do anymore
            return st.size;
        }

        let output = 0;
        for (const file of this.list()[0]) {
            output += this.get(file).size();
        }

        return output;
    }

    open(flags) {
        //console.log("open " + this.relativePath + " appid " + this.appid);
        if (this.scope === "data") {
            if (this.appid) {
                this._f = hmFS.open(this.relativePath, flags, {appid: this.appid});
            } else {
                this._f = hmFS.open(this.relativePath, flags);
            }
        } else {
            this._f = hmFS.open_asset(this.relativePath, flags);
        }

        return this._f;
    }

    remove() {
        if(this.scope === "assets")
            return this.resolve().remove();

        try {
            hmFS.remove(isMiBand7 ? this.absolutePath : this.relativePath);
            return true;
        } catch (e) {
            return false;
        }
    }

    removeTree() {
        // Recursive !!!
        const [files, e] = this.list();
        for (let i in files) {
            this.get(files[i]).removeTree();
        }

        this.remove();
    }

    fetch(limit = Infinity) {
        const [st, e] = this.stat();
        if (e != 0) return null;

        const length = Math.min(limit, st.size);
        const buffer = new ArrayBuffer(st.size);
        this.open(hmFS.O_RDONLY);
        this.read(buffer, 0, length);
        this.close();

        return buffer;
    }

    // fetch() {
    //     console.log('fetch file:' + this.relativePath);
    //
    //     const [st, e] = this.stat();
    //
    //     console.log( 'stat size' +  st.size);
    //
    //     let chunkSize = 256;
    //     let bytesRead = 0
    //     const chunks = [];
    //     this.open(hmFS.O_RDONLY);
    //     while (true) {
    //         const buffer = new ArrayBuffer(chunkSize);
    //         const count = this.read(buffer, 0, chunkSize);
    //         console.log("read:" + count)
    //         if (count <= 0) {
    //             break;
    //         }
    //
    //         chunks.push(new Uint8Array(buffer, 0, count));
    //         bytesRead += count;
    //
    //         if (count < chunkSize) {
    //             break;
    //         }
    //     }
    //
    //     this.close();
    //     if (bytesRead === 0) {
    //         return null;
    //     }
    //     console.log("bytesRead:" + bytesRead)
    //     // Concatenate all chunks
    //     const allData = new Uint8Array(bytesRead);
    //     let offset = 0;
    //     for (const chunk of chunks) {
    //         allData.set(chunk, offset);
    //         offset += chunk.length;
    //     }
    //     return allData;
    // }

    fetchText(limit = Infinity) {
        const buf = this.fetch(limit);
        if (!buf) return buf;

        if (this.localFS){
            return FsTools.ab2str(buf);
        }
        else{
            return FsTools.decodeUtf8(buf, limit)[0];
        }
    }

    fetchJSON() {
        const text = this.fetchText();

        if (!text) return text;
        try {
            return JSON.parse(text);
        } catch (e) {
            console.log('cannot parse json');
            return null;
        }
    }

    override(buffer) {
        this.remove();

        this.open(hmFS.O_WRONLY | hmFS.O_CREAT);
        this.write(buffer, 0, buffer.byteLength);
        this.close();
    }

    overrideWithText(text) {
        let buf;
        if (this.localFS){
            buf = FsTools.str2ab(text);
        }
        else{
            buf = FsTools.strToUtf8(text);
        }
        return this.override(buf);
    }

    overrideWithJSON(data) {
        return this.overrideWithText(JSON.stringify(data));
    }

    copy(destEntry) {
        const buf = this.fetch();
        destEntry.override(buf);
    }

    copyTree(destEntry, move = false) {
        // Recursive !!!
        if (this.isFile()) {
            this.copy(destEntry);
        } else {
            dest.mkdir();
            for (const file of this.list()[0]) {
                this.get(file).copyTree(destEntry.get(file));
            }
        }

        if (move) this.removeTree();
    }

    isFile() {
        const [st, e] = this.stat();
        return e == 0 && (st.mode & 32768) != 0;
    }

    isFolder() {
        if (this.absolutePath == "/storage") return true;
        const [st, e] = this.stat();
        return e == 0 && (st.mode & 32768) == 0;
    }

    exists() {
        return this.stat()[1] == 0;
    }

    list() {
        return hmFS.readdir(isMiBand7 ? this.absolutePath : this.relativePath);
    }

    mkdir() {
        const path = isMiBand7 ? this.absolutePath : this.relativePath;
        return hmFS.mkdir(path);
    }

    seek(val) {
        hmFS.seek(this._f, val, hmFS.SEEK_SET);
    }

    read(buffer, offset, length) {
        console.log("read");
        return hmFS.read(this._f, buffer, offset, length)
    }

    write(buffer, offset, length) {
        console.log("write");
        hmFS.write(this._f, buffer, offset, length)
    }

    close() {
        hmFS.close(this._f);
    }
}

export class FsTools {
    static getAppLocation() {
        if (FsTools.overrideAppPage) {
            return FsTools.overrideAppPage;
        }

        const packageInfo = hmApp.packageInfo();
        const idn = packageInfo.appId.toString(16).padStart(8, "0").toUpperCase();
        return [`js_${packageInfo.type}s`, idn];
    }

    static fullAssetPath(path) {
        const [base, idn] = FsTools.getAppLocation();
        return `/storage/${base}/${idn}/assets${path}`;
    }

    static fullDataPath(path) {
        const [base, idn] = FsTools.getAppLocation();
        return `/storage/${base}/data/${idn}${path}`;
    }

    // https://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    static strToUtf8(str) {
        var utf8 = [];
        for (var i = 0; i < str.length; i++) {
            var charcode = str.charCodeAt(i);
            if (charcode < 0x80) utf8.push(charcode);
            else if (charcode < 0x800) {
                utf8.push(0xc0 | (charcode >> 6),
                    0x80 | (charcode & 0x3f));
            } else if (charcode < 0xd800 || charcode >= 0xe000) {
                utf8.push(0xe0 | (charcode >> 12),
                    0x80 | ((charcode >> 6) & 0x3f),
                    0x80 | (charcode & 0x3f));
            } else {
                i++;
                charcode = 0x10000 + (((charcode & 0x3ff) << 10) |
                    (str.charCodeAt(i) & 0x3ff));
                utf8.push(0xf0 | (charcode >> 18),
                    0x80 | ((charcode >> 12) & 0x3f),
                    0x80 | ((charcode >> 6) & 0x3f),
                    0x80 | (charcode & 0x3f));
            }
        }

        return new Uint8Array(utf8).buffer;
    }

    // source: https://stackoverflow.com/questions/13356493/decode-utf-8-with-javascript
    static decodeUtf8(array, outLimit = Infinity, startPosition = 0) {
        let out = "";
        let length = array.length;

        let i = startPosition,
            c, char2, char3;
        while (i < length && out.length < outLimit) {
            c = array[i++];
            switch (c >> 4) {
                case 0:
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                    // 0xxxxxxx
                    out += String.fromCharCode(c);
                    break;
                case 12:
                case 13:
                    // 110x xxxx   10xx xxxx
                    char2 = array[i++];
                    out += String.fromCharCode(
                        ((c & 0x1f) << 6) | (char2 & 0x3f)
                    );
                    break;
                case 14:
                    // 1110 xxxx  10xx xxxx  10xx xxxx
                    char2 = array[i++];
                    char3 = array[i++];
                    out += String.fromCharCode(
                        ((c & 0x0f) << 12) |
                        ((char2 & 0x3f) << 6) |
                        ((char3 & 0x3f) << 0)
                    );
                    break;
            }
        }

        return [out, i - startPosition];
    }

    static ab2str(buf) {
        return String.fromCharCode.apply(null, new Uint8Array(buf));
    }

    static str2ab(str) {
        var buf = new ArrayBuffer(str.length)
        var bufView = new Uint8Array(buf)
        for (var i = 0, strLen = str.length; i < strLen; i++) {
            bufView[i] = str.charCodeAt(i)
        }
        return buf
    }

    static Utf8ArrayToStr(array) {
        return FsTools.decodeUtf8(array)[0];
    }

    static printBytes(val) {
        if (this.fsUnitCfg === undefined)
            this.fsUnitCfg = hmFS.SysProGetBool("mmk_tb_fs_unit");

        const options = this.fsUnitCfg ? ["B", "KiB", "MiB"] : ["B", "KB", "MB"];
        const base = this.fsUnitCfg ? 1024 : 1000;

        let curr = 0;
        while (val > 800 && curr < options.length) {
            val = val / base;
            curr++;
        }

        return Math.round(val * 100) / 100 + " " + options[curr];
    }
}