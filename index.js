const child_process = require("child_process");
const process = require("process");
const fs = require('fs');
const xml2js = require('xml2js');
const deasync = require('deasync');

const parseXml = deasync(xml2js.parseString);

const USER_HOME = process.env.HOME || process.env.USERPROFILE;

const ToolBoxDir = USER_HOME + "/AppData/Local/JetBrains/Toolbox";

const AppDir = ToolBoxDir + "/apps";

function getAllInstalledApp() {
    return fs
        .readdirSync(AppDir)
        .filter(v => fs.lstatSync(AppDir + "/" + v).isDirectory())
        .map(v => {
            return {
                "name": v,
                "path": AppDir + "/" + v + "/" + "ch-0"
            }
        })
}

function getInstalledAppInfo(path) {
    let historyPath = path + "/.history.json";

    if (!fs.existsSync(historyPath))
        return null;

    let json = JSON.parse(fs.readFileSync(historyPath, "utf-8"))['history'][0]['item'];

    let result = {
        'app-name': json['name'],
        'app-path': json['system-app-path'] + '/' + json['package']['command'],
        'app-icon-path': json['system-app-path'] + '/bin/' + json['intellij_platform']['shell_script_name'] + '.svg',
        'recent-path': json['intellij_platform']['default_config_directories']['idea.config.path'].replace("$HOME", USER_HOME)
    };

    if (fs.existsSync(result['recent-path'] + '/options/recentProjectDirectories.xml')) {
        result['recent-path'] += '/options/recentProjectDirectories.xml'
    } else {
        result['recent-path'] += '/options/recentProjects.xml'
    }

    return result
}

function parseRecentDirectory(path) {
    return parseXml(fs.readFileSync(path, "utf-8"));
}

function getRecentProject(path) {
    if (!fs.existsSync(path))
        return null;

    let xml = parseRecentDirectory(path);

    console.log(xml);

    let option = xml['application']['component'][0]['option'][0];

    if(!option.hasOwnProperty('map')){
        return null;
    }

    option = option['map'][0]['entry'];

    let directory = [];

    for (const o of option) {
        let path = o['$']['key'];
        let timestamp = o['value'][0]['RecentProjectMetaInfo'][0]['option'][4]['$']['value'];

        let name = path.substring(path.lastIndexOf('\\') + 1);
        name = name.substring(name.lastIndexOf('/') + 1);
        name = name.replace(/^\w/, c => c.toUpperCase());

        directory.push({
            'name': name,
            'path': path,
            'timestamp': timestamp
        })
    }

    return directory
}

function getAllRecentProject() {
    let app = getAllInstalledApp();

    let result = [];

    for (const o of app) {
        let info = getInstalledAppInfo(o['path']);

        if (info == null)
            continue;

        let recentProject = getRecentProject(info['recent-path']);

        if (recentProject == null)
            continue;

        result.push({
            "app-path": info['app-path'],
            "app-ico": info['app-icon-path'],
            "recent-project": recentProject
        })
    }

    return result
}

function getRecentProjectList() {
    let recentProject = getAllRecentProject();
    let result = [];

    for (const r of recentProject) {
        for (const p of r['recent-project']) {
            let time = parseInt(p['timestamp']);
            result.push({
                title: p['name'],
                description: '时间: ' + new Date(time).toLocaleString() + ' 路径: ' + p['path'],
                timestamp: time,
                icon: "file://" + r['app-ico'],
                exec: r['app-path'],
                path: p['path']
            })
        }
    }

    return result.sort((a, b) => {
        return b['timestamp'] - a['timestamp']
    });
}

window.exports = {
    QuickJet: {
        mode: "list",
        args: {
            enter: (action, callbackSetList) => {
                window.__jet__cache = getRecentProjectList();
                callbackSetList(window.__jet__cache);
            },
            search: (action, searchWord, callbackSetList) => {
                let lower = searchWord.toLowerCase();
                callbackSetList(
                    window.__jet__cache.filter(v => {
                        return (
                            v.title.toLowerCase().search(lower) !== -1 ||
                            v.description.toLowerCase().search(lower) !== -1
                        );
                    })
                );
            },
            select: (action, itemData, callbackSetList) => {
                window.utools.hideMainWindow();
                child_process.spawn(itemData['exec'], [itemData['path']], {
                    detached: true
                });
                window.__jet__cache = null;
                window.utools.outPlugin();
            },
            placeholder: ""
        }
    }
};