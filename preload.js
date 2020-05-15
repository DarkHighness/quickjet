const fs = require('fs');
const fp = fs.promises;
const xml2js = require("xml2js");
const process = require('process');
const child_process = require("child_process");
const path = require('path');

function getUserHome() {
    return process.env.HOME || process.env.USERPROFILE;
}

function getUserAppData(){
    return process.env.APPDATA
}

function getUserLocalAppData(){
    return process.env.LOCALAPPDATA
}

async function getToolboxAppPath() {
    let toolbox = "";

    if (typeof window == "undefined" || window.utools.isWindows()) {
        toolbox = "/AppData/Local/JetBrains/Toolbox";
    }
    else if  (window.utools.isMacOs()) {
        toolbox = "/Library/Application Support/JetBrains/Toolbox";
    }

    const userHome = getUserHome();
    const app = "/apps";

    const fullPath = path.join(userHome, toolbox, app);

    console.log("Jetbrains Toolbox下的Apps文件夹路径:", fullPath);

    if (fs.existsSync(fullPath)) {
        console.log("确定Jetbrains Toolbox下的Apps文件夹存在.");

        return Promise.resolve(fullPath);
    }

    console.error("无法在Jetbrains的默认路径找到App文件夹.");

    return Promise.reject("无法在Jetbrains的默认路径找到App文件夹.")
}

async function getInstalledApps() {
    try {
        const appPath = await getToolboxAppPath();
        const files = await fp.readdir(appPath);

        console.log("路径下所有文件:", files);

        const result = files
            .filter(file => {
                const fullPath = path.join(appPath, file);
                const stats = fs.lstatSync(fullPath);
                return stats.isDirectory();
            })
            .map(dir => {
                return {
                    name: dir,
                    "full-path": path.join(appPath, dir, "ch-0")
                }
            });

        console.log("具体安装路径:", result);

        return Promise.resolve(result);

    } catch (error) {

        if (typeof window != "undefined" && window.hasOwnProperty("utools")) {
            window.utools.showNotification(
                "无法在Jetbrains的默认路径找到App文件夹?确认是采用默认安装吗?",
                clickFeatureCode = null,
                silent = false
            );

            return Promise.reject(error)
        }
    }
}

async function getAppInfoByPath(appPath) {
    const historyPath = path.join(appPath, ".history.json");

    if (!fs.existsSync(historyPath)) {
        console.error("无法在找到位于 " + historyPath + " 的历史数据.");
        return Promise.reject("无法在找到位于 " + historyPath + " 的历史数据.")
    }

    const history = await fp.readFile(historyPath, {encoding: "utf-8"});
    const histories = JSON.parse(history)["history"]
    const json = histories[histories.length - 1]["item"]

    let command = ""
    let binPath = ""

    if (typeof window == "undefined" || window.utools.isWindows()) {
        command  = json["package"]["command"]
        binPath = "bin"
    }
    else if (window.utools.isMacOs()) {
        command = 'Contents/MacOS/' + json["intellij_platform"]["shell_script_name"]
        binPath = "Contents/bin"
    }

    const result = {
        "app-name": json["name"],
        "app-path": path.join(json["system-app-path"], command),
        "app-icon-path": path.join(json["system-app-path"], binPath, json["intellij_platform"]["shell_script_name"] + '.svg'),
        "recent-path": path.join(json["intellij_platform"]["default_config_directories"]["idea.config.path"].replace(
            "$APPDATA", getUserAppData()).replace("$HOME", getUserHome()), "options")
    };

    if (fs.existsSync(path.join(result["recent-path"], "recentProjectDirectories.xml"))) {
        result["recent-path"] = path.join(result["recent-path"], "recentProjectDirectories.xml");
    } else if (fs.existsSync(path.join(result["recent-path"], "recentProjects.xml"))) {
        result["recent-path"] = path.join(result['recent-path'], "recentProjects.xml");
    } else {
        return Promise.reject("无法找到最近项目文件...")
    }

    console.log("App: ", result['app-name']);
    console.log(result);

    return Promise.resolve(result);
}

async function getRecentProjectXml(fullPath) {
    const data = await fp.readFile(fullPath, {encoding: "utf-8"});

    return new Promise((resolve, reject) => {
        xml2js.parseString(data, (err, result) => {
            if (err) reject(err);
            resolve(result);
        })
    });
}

function capitalizedString(str) {
    return str.replace(/^\w/, c => c.toUpperCase());
}

async function parseRecentXml(xml) {
    const option = xml["application"]["component"][0]["option"][0];

    if (!option.hasOwnProperty("map")) {
        return Promise.reject("该APP目前暂无最近项目.");
    }

    const entry = option["map"][0]["entry"];

    const projects = [];

    for (const o of entry) {
        const fullPath = o["$"]["key"].replace("$USER_HOME$", getUserHome());
        const timestamp = o["value"][0]["RecentProjectMetaInfo"][0]["option"][4]["$"]["value"];
        const stats = path.parse(fullPath);

        if(!fs.existsSync(fullPath)){
            console.warn("项目路径:",fullPath," 不存在.");
            continue;
        }

        projects.push({
            name: capitalizedString(stats['name']),
            path: fullPath,
            timestamp: timestamp
        });
    }

    return Promise.resolve(projects);
}

async function getRecentProject() {
    const container = [];

    try {
        const apps = await getInstalledApps();
        for (const app of apps) {
            try {
                const info = await getAppInfoByPath(app['full-path']);
                const xml = await getRecentProjectXml(info['recent-path']);
                const recentProject = await parseRecentXml(xml);

                for (const project of recentProject) {
                    const timestamp = parseInt(project['timestamp']);
                    container.push({
                        "app-path": info["app-path"],
                        "icon": "file://" + info["app-icon-path"],
                        "title": project['name'],
                        "path": project['path'],
                        "timestamp": timestamp,
                        "description": "时间: " + new Date(timestamp).toLocaleString() + " 路径: " + project["path"]
                    })
                }
            } catch (error) {
                console.warn(error);
            }
        }
    } catch (error) {
        console.warn(error);
    }

    const result = container.sort((a, b) => {
        return b["timestamp"] - a["timestamp"];
    });

    return Promise.resolve(result);
}

async function get(callback) {
    const result = await getRecentProject();

    if (typeof window != "undefined") {
        window.__jet__cache = result;
    }

    callback(result);

    return Promise.resolve();
}

async function search(word, callback) {
    let cache = null;

    if (typeof window != "undefined") {
        if (window.__jet__cache == null) {
            window.__jet__cache = await getRecentProject();
            cache = window.__jet__cache;
        }
    }

    if (cache == null)
        cache = await getRecentProject();

    const lower = word.toLowerCase();

    callback(
        cache.filter(v => {
            return (
                v.title.toLowerCase().search(lower) !== -1 ||
                v.description.toLowerCase().search(lower) !== -1
            );
        })
    );

    return Promise.resolve();
}

async function execute(data) {
    if (typeof window != "undefined") {
        if (window.__jet__cache != null) {
            window.__jet__cache = null;
        }

        window.utools.hideMainWindow();
        child_process.spawn(data["app-path"], [data["path"]], {
            detached: true
        });
        window.utools.outPlugin();
    }

    return Promise.resolve();
}

if(typeof window != "undefined"){
    window.exports = {
        QuickJet: {
            mode: "list",
            args: {
                enter: (action, callbackSetList) => {
                    get(callbackSetList);
                },
                search: (action, searchWord, callbackSetList) => {
                    search(searchWord, callbackSetList);
                },
                select: (action, itemData, callbackSetList) => {
                    execute(itemData)
                },
                placeholder: ""
            }
        }
    };
}