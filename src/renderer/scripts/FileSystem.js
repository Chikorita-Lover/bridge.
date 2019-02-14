import fs from "fs";
import mkdirp from "mkdirp";
import dirToJson from "dir-to-json";
import { BASE_PATH } from "./constants.js";
import Store from "../store/index";
import Vue from "../main";
import TabSystem from "./TabSystem";
import { ipcRenderer } from "electron";
import Cache from "./utilities/Cache.js";

function getPath(path) {
    return BASE_PATH + path;
}

class FileSystem {
    constructor() {
        this.Cache = new Cache();
    }
    save(path, content, update=false, open=false) {
        let tmp_path = getPath(path).split("/");
        tmp_path.pop();
        tmp_path = tmp_path.join("/");
        fs.exists(tmp_path, (exists) => {
            if(!exists) mkdirp.sync(tmp_path);

            fs.writeFile(getPath(path), content, (err) => {
                if(err) console.log(err);

                if(update) {
                    Vue.$root.$emit("refreshExplorer");
                }
                if(open) {
                    this.addAsTab(getPath(path), content, content);
                }
            });
        });
    }
    basicSave(path, content, update=false) {
        fs.writeFile(path, content, err => {
            if(err) throw err;
            if(update) {
                Vue.$root.$emit("refreshExplorer");
            }
        });
    }
    basicSaveAs(path, content) {
        ipcRenderer.send("saveAsFileDialog", { path, content });
    }

    open(path) {
        this.Cache.get(path)
            .then((cache) => cache.content ? 
                this.addAsTab(path, cache.content) : 
                fs.readFile(path, (err, data) => {
                    if(err) throw err;
                    this.addAsTab(path, data.toString(), data);
            }))
            .catch((err) => {
                console.log("[OPEN] Not opened from cache");
                fs.readFile(path, (err, data) => {
                    if(err) throw err;
                    this.addAsTab(path, data.toString(), data);
                });
            });
    }
    addAsTab(path, data, raw_data) {
        TabSystem.add({ 
            content: data,
            raw_content: raw_data,
            file_path: path,
            category: Store.state.Explorer.project,
            file_name: path.split(/\/|\\/).pop()
        });
    }
}

const FILE_SYSTEM = new FileSystem();
ipcRenderer.on("openFile", (event, path) => {
    FILE_SYSTEM.open(path);
});

export default FILE_SYSTEM;