#!/usr/bin/env node

"use strict";

// 可以抓取SS账号的网页，及其CSS选择符
const { JSDOM } = require('jsdom');
const srvs = {
	"https://freessr.xyz/": ".text-center",
	"https://a.ishadow.tech/": "#free .col-sm-4.text-center",
	// "http://isx.yt": "#free .col-sm-4.text-center",
	"http://ss.ishadowx.com/": "#portfolio .hover-text",
};
const strategy = "com.shadowsocks.strategy.ha";
let hasChange;
const configPath = require("path").join(__dirname, "gui-config.json");
let config;
let childProcess;
let fs = require("fs-extra");
let request = require("request");

// 中文所对应的配置项key名
const keyMap = {
	"IP": "server",
	"加密方式": "method",
	"密码": "password",
	"服务器地址": "server",
	"服务地址": "server",
	"服务密码": "password",
	"服务端口": "server_port",
	"端口号": "server_port",
	"端口": "server_port",
	"状态": "remarks",
	"ip address": "server",
	"port": "server_port",
};

const defaultConfig = {
	"configs": [],
	"index": -1,
	"localPort": 1080,
	"shareOverLan": true,
	"strategy": strategy,
};

function upObj(objOld, objNew) {
	for (let key in objNew) {
		if (String(objOld[key]) !== String(objNew[key])) {
			objOld[key] = objNew[key];
			hasChange = true;
		}
	}
	return objOld;
}

function getConfig() {
	return fs.readJson(configPath)

	.then(data => {
		return config = upObj(data, {
			// 配置为自动选择服务器
			"index": -1,
			// 允许局域网内的计算机连接
			"shareOverLan": true,
			// 若未配置服务器选择算法，则将其配置为“高可用”
			"strategy": data.strategy || strategy,
		});
	})

	.catch(() => {
		// 配置文件读取错误，使用默认配置
		return config || (config = defaultConfig);
	});
}

function getNewConfig() {
	return getServers(srvs)

	.then(updateConfig);
}

function updateConfig(servers) {
	return getConfig().then(config => {
		let newServers = [];
		if (config.configs) {
			servers = servers.filter(server => {
				// 在已有配置中寻找相同的配置项，将其替换
				return !config.configs.some(cfgServer => {
					if (cfgServer.server === server.server && cfgServer.server_port === server.server_port) {
						upObj(cfgServer, server);
						newServers.push(cfgServer);
						return true;
					}
				});
			});
		}
		// 在配置文件中未找到的全新服务器，追加至配置
		if (servers.length) {
			newServers = newServers.concat(servers);
			hasChange = true;
		}

		if (hasChange) {
			// 需要更新配置文件
			let result = [];
			let rcPath;
			if(process.platform === "win32"){
				rcPath = require("path").join(__dirname, "rc.txt");
			} else {
				rcPath = require("path").join(require("os").homedir(), ".cow/rc");
			}
			result.push(fs.outputFile(rcPath, ["listen = http://0.0.0.0:1080", "loadBalance = latency"].concat(newServers.map(server => {
				return `proxy = ss://${ server.method || "aes-256-cfb" }:${ server.password || "" }@${ server.server }:${ server.server_port || 443 }`;
			})).join("\n") + "\n"));

			config.configs = newServers;
			result.push(fs.outputJson(configPath, config, {
				spaces: '\t'
			}));
			return Promise.all(result);
		}
		return false;
	}).catch(exit);
}

function runShadowsocks() {
	return new Promise((resolve, reject) => {
		let resolved;

		// 重新启动Shadowsocks
		const child_process = require("child_process");
		childProcess = null;

		try {
			// 终止现有的Shadowsocks进程
			child_process.execSync(process.platform === "win32" ? "taskkill /f /im Shadowsocks.exe&&taskkill /f /im ss_privoxy.exe" : "killall cow");
			setTimeout(startProcess, 3000);
		} catch (ex) {
			startProcess();
		}

		function startProcess() {
			function callback() {
				if (!resolved) {
					resolved = true;
					log("已启动Shadowsocks");
					resolve(childProcess);
				}
			}

			// 新开Shadowsocks进程
			childProcess = child_process.execFile(require("path").join(__dirname, process.platform === "win32" ? "Shadowsocks.exe" : "cow"), error => reject(error));

			// 进程意外退出则自动重启进程
			childProcess.on("close", () => {
				if (childProcess) {
					childProcess = null;
					log("Shadowsocks进程意外崩溃");
					setTimeout(runShadowsocks, 3000);
				}
			});

			// 输出子进程控制台信息
			childProcess.stdout.on("data", data => {
				console.log(data.toString());
				callback();
			});

			// 输出子进程控制台错误
			childProcess.stderr.on("data", data => {
				console.error(data.toString());
			});

			process.nextTick(callback);
		}
	});
}

function getDomFromUrl(url, selector) {
	return JSDOM.fromURL(url).then(dom => {
		if (selector && (typeof selector === "string")) {
			return Array.from(dom.window.document.querySelectorAll(selector));
		} else {
			return [dom.window.document.documentElement];
		}
	}).catch(() => {
		log(`${ url }\t获取服务器信息失败`);
		return false;
	});
}

function getServers(configs) {
	let reqs = [];
	for (let url in configs) {
		reqs.push(getDomFromUrl(url, configs[url]));
	}
	return Promise.all(reqs)

	.then(ress => {
		// 数组降维
		ress = Array.prototype.concat.apply([], ress).filter(node => {
			// 过滤掉数组中的空元素
			return node;
		}).map(node2config).filter(node => {
			// 过滤掉数组中的无效数据
			return node.server && node.password && node.remarks !== "暂停";
		});
		if (ress.length) {
			log(`共获取到${ ress.length }个服务器`);
			return ress;
		} else {
			log(`获取服务器失败，正在重试`);
			return getServers(configs);
		}
	});
}

function node2config(node) {
	// 提取dom元素中的信息
	let text = (node.innerText || node.textContent).trim();
	if (/\n/.test(text)) {
		// 一般的正常情况，按换行符分隔字符串即可
		node = text.split(/\s*\n\s*/g);
	} else {
		// 貌似jsDOM不支持innerText属性，所以采用分析子节点的办法
		node = Array.from(node.childNodes).filter(node => {
			return node.nodeType === 3;
		}).map(node => {
			return (node.innerText || node.textContent).trim();
		});
	}

	// 将提取到的信息，转为配置文件所需格式
	let server = {
		"server": "",
		"server_port": 0,
		"password": "",
		"method": "",
		"remarks": ""
	};

	// 遍历每行信息
	node.forEach(inf => {
		// 按冒号分隔字符串
		inf = inf.split(/\s*[:：]\s*/g);
		let key = inf[0].toLowerCase();
		let val = inf[1];
		if (key && inf.length > 1) {
			// 根据中文提示，查字典找到配置项key名
			key = keyMap[key] || (function() {
				// 字典中找不到的，按字符串查找方式匹配
				for (let keyName in keyMap) {
					if (key.indexOf(keyName) > -1) {
						return keyMap[keyName];
					}
				}
			})() || key;
			// 写入数据
			if (key && !server[key]) {
				server[key] = key === "password" ? val : val.toLowerCase();
			}
		}
	});

	// 服务器端口号转换为整数
	server.server_port = +server.server_port || 443;
	console.log(server)
	server.method = server.method || "aes-256-cfb";

	return server;
}

// 使用代理尝试访问墙外网站
function getProxyStatus(url) {
	return new Promise((resolve, reject) => {
		// 配置URL
		let opt = {
			url: url,
			timeout: 5000,
			// 配置HTTP代理
			proxy: "http://127.0.0.1:" + (config.localPort || 1080),
		};

		let r = request.get(opt)

		.on("response", response => {
			r.abort();
			if (response.statusCode >= 200) {
				resolve(response);
			} else {
				reject(response);
			}
		})

		.on("error", reject);
	});
}

const urls = [
	"https://www.youtube.com/",
	"https://www.facebook.com/",
	"https://twitter.com/",
	"https://plus.google.com/",
];

function proxyTest(index) {
	// 使用代理尝试访问墙外网站
	index = index || 0;
	let url = urls[index];
	let timer = new Date();
	log(`尝试使用代理访问\t${ url }\t`);
	return getProxyStatus(url).then(() => {
		// 成功拿到墙外网站的响应，一切正常
		// 代理正常，3秒后再试
		log(`代理测试正常\t耗时: ${ new Date() - timer }ms`);
	}).catch(() => {
		// 代理出错，统计出错次数
		log("代理测试失败");
		if (++index >= urls.length) {
			throw new Error("无法翻墙");
		} else {
			// 重测代理并多错误次数计数
			return proxyTest(index);
		}
	});
}

// 测试自动代理工具是否正常
function getPac() {
	return new Promise((resolve, reject) => {
		// 配置URL
		let opt = {
			url: "http://127.0.0.1:" + (config.localPort || 1080) + "/pac",
			timeout: 600,
		};

		let r = request.get(opt)

		.on("response", response => {
			r.abort();
			if (response.statusCode >= 200) {
				resolve(response);
			} else {
				reject(response);
			}
		})

		.on("error", reject);
	})

	.catch(error => {
		log("pac文件访问失败");
		throw error;
	});
}

function startHeartBeat() {
	setTimeout(heartBeat, 3000);
}

function heartBeat() {

	getPac()

	.catch(runShadowsocks)

	.then(() => proxyTest())

	.catch(() => {
		return getNewConfig()

		.then(hasChange => {
			return hasChange ? runShadowsocks() : null;
		});
	})

	.then(startHeartBeat);

}

function log(msg) {
	function fmtd(d) {
		return `${ d < 10 ? "0" : "" }${ d }`;
	}
	let time = new Date();
	msg = `[${ fmtd(time.getHours()) }:${ fmtd(time.getMinutes()) }:${ fmtd(time.getSeconds()) }] ${ String(msg).replace(/\b(\w+\:\/+[^\/]+\/?)\S*/, "$1") }`;
	console.log(msg);
}

process.on("uncaughtException", err => {
	console.error("Caught exception:", err);
});

log("启动成功，正在寻找免费帐号");

getNewConfig()

.then(runShadowsocks)

.catch(exit)

.then(startHeartBeat);

function exit(error) {
	console.error(error);
	process.exit(error ? 1 : 0);
}
