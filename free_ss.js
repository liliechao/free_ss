#!/usr/bin/env node

"use strict";

// 可以抓取SS账号的网页，及其CSS选择符
const srvs = {
	"http://www.ishadowsocks.com/": "#free .col-lg-4.text-center",
	"http://freeshadowsocks.cf/": ".text-center",
};
const strategy = "com.shadowsocks.strategy.ha";
var hasChange;
const configPath = require("path").join(__dirname, "gui-config.json");
var config;
var childProcess;
var errCont = 0;

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
};

const defaultConfig = {
	"configs": [],
	"strategy": strategy,
	"index": -1,
	"localPort": 1080
};

function upObj(objOld, objNew) {
	for (var key in objNew) {
		if (String(objOld[key]) !== String(objNew[key])) {
			objOld[key] = objNew[key];
			hasChange = true;
		}
	}
	return objOld;
}

function getConfig() {
	return new Promise((resolve, reject) => {
		require("fs").readFile(configPath, (err, data) => {
			hasChange = false;
			if (err) {
				// 配置文件读取错误
				return reject(err);
			}
			try {
				data = eval.call(null, "(" + data + ")");
			} catch (ex) {
				// 配置文件格式错误
				return reject(ex);
			}
			resolve(config = upObj(data, {
				// 配置为自动选择服务器
				"index": -1,
				// 若未配置服务器选择算法，则将其配置为“高可用”
				"strategy": data.strategy || strategy
			}));
		});
	}).catch(() => {
		// 配置文件读取错误，使用默认配置
		return config || defaultConfig;
	}).then(data => {
		// 将配置信息写入全局
		return config = data;
	});
}

function updateConfig(servers) {
	return getConfig().then(config => {
		servers = servers.filter(server => {
			// 在已有配置中寻找相同的配置项，将其替换
			return !config.configs.some(cfgServer => {
				if (cfgServer.server === server.server && cfgServer.server_port === server.server_port) {
					upObj(cfgServer, server);
					return true;
				}
			});
		});

		// 在配置文件中未找到的全新服务器，追加至配置
		if (servers.length) {
			config.configs = config.configs.concat(servers);
			hasChange = true;
		}

		if (hasChange) {
			// 需要更新配置文件
			if (process.platform !== "win32") {
				var contents = ["listen = http://0.0.0.0:1080", "loadBalance = latency"].concat(config.configs.map(server => {
					return `proxy = ss://${ server.method || "aes-256-cfb" }:${ server.password || "" }@${ server.server }:${ server.server_port || 443 }`;
				}));
				contents = contents.join("\n") + "\n";
				require("fs").writeFile(require("path").join(require("os").homedir(), ".cow/rc"), contents, err => {
					console.error(err);
	                        });
			}
			require("fs").writeFile(configPath, JSON.stringify(config, null, "  "), err => {
				if (!err) {
					log(`已更新配置文件\t${ configPath }`);
				}
				if (childProcess) {
					if (!err) {
						// 更新配置后重启Shadowsocks
						childProcess.kill();
					}
				} else {
					// 初始化
					runShadowsocks();
				}
			});
		} else if (childProcess) {
			// 未更新配置，6秒后重测试代理
			setTimeout(proxyTest, 6000);
		} else {
			// 初始化
			runShadowsocks();
		}
	});
}

function getInfos() {
	getServers(srvs).then(updateConfig);
}

function runShadowsocks() {
	// 重新启动Shadowsocks
	const child_process = require("child_process");
	log(`已${ childProcess ? "重启" : "启动" }Shadowsocks`);
	if (process.platform === "win32") {
		childProcess = child_process.exec("taskkill /f /im Shadowsocks.exe&&taskkill /f /im ss_privoxy.exe", () => {
			childProcess = child_process.execFile("Shadowsocks.exe");
			childProcess.on("close", () => {
				setTimeout(runShadowsocks, 3000);
			});
			setTimeout(proxyTest, 3000);
		});
	} else {
		childProcess = child_process.exec(require("path").join(__dirname, "cow"), err => {
			if(err) {
				console.error(err);
			}
		});
		childProcess.on("close", () => {
			setTimeout(runShadowsocks, 3000);
		});
		childProcess.stdout.on("data", data => {
			console.log(data);
		});
		setTimeout(proxyTest, 3000);
	}
}

function getDomFromUrl(url, selector) {
	return new Promise((resolve, reject) => {
		// 请求远程数据
		require("jsdom").env({
			url: url,
			done: (err, window) => {
				// 获取到DOM，查询节点返回给后续处理流程
				if (err) {
					reject(err);
				} else if (selector && (typeof selector === "string")) {
					resolve(Array.from(window.document.querySelectorAll(selector)));
				} else {
					resolve([window.document.documentElement]);
				}
			}
		});
	}).catch(() => {
		log(`${ url }\t获取服务器信息失败`);
		return false;
	});
}

function getServers(configs) {
	var reqs = [];
	for (var url in configs) {
		reqs.push(getDomFromUrl(url, configs[url]));
	}
	return Promise.all(reqs).then(ress => {
		// 数组降维
		ress = Array.prototype.concat.apply([], ress).filter(node => {
			// 过滤掉数组中的空元素
			return node;
		}).map(node2config).filter(node => {
			// 过滤掉数组中的空元素
			return node.server;
		});
		if (ress.length) {
			log(`共获取到${ ress.length }个服务器`);
		}
		return ress;
	});
}

function node2config(node) {
	// 提取dom元素中的信息
	var text = (node.innerText || node.textContent).trim();
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
	var server = {
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
		var key = inf[0];
		var val = inf[1];
		if (key && inf.length > 1) {
			// 根据中文提示，查字典找到配置项key名
			key = keyMap[key] || (function() {
				// 字典中找不到的，按字符串查找方式匹配
				for (var keyName in keyMap) {
					if (key.indexOf(keyName) > -1) {
						return keyMap[keyName];
					}
				}
			})();
			// 写入数据
			if (key && !server[key]) {
				server[key] = key === "password" ? val : val.toLowerCase();
			}
		}
	});

	server.server_port = +server.server_port || 443;
	server.method = server.method || "aes-256-cfb";

	return server;
}

// 使用代理尝试访问墙外网站
function getProxyStatus(url) {
	return new Promise((resolve, reject) => {
		// 配置URL
		var opt = {
			url: url,
			timeout: 8000,
			// 配置HTTP代理
			proxy: "http://127.0.0.1:" + (config.localPort || 1080),
		};

		var r = require("request").get(opt)

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
	"http://s3.amazonaws.com/psiphon/landing-page-redirect/redirect.html",
	"http://www.google.com/",
	"http://www.youtube.com/",
	"http://www.facebook.com/"
];

function proxyTest(index) {
	// 使用代理尝试访问墙外网站
	index = index || 0;
	var url = urls[index];
	getProxyStatus(url).then(() => {
		// 成功拿到墙外网站的响应，一切正常
		// 代理正常，40秒后再试
		setTimeout(proxyTest, 40000);
		log(`代理测试正常\t耗时: ${ new Date() - timer }ms`);
		errCont = 0;
	}).catch(() => {
		// 代理出错，统计出错次数
		log("代理测试失败");
		if (++index >= urls.length) {
			// 代理测试连续6次错误则重启Shadowsocks进程
			if (errCont >= 6 && childProcess) {
				errCont = 0;
				childProcess.kill();
			} else {
				// 重新拉取服务器信息
				getInfos();
				log("尝试重新获取账号");
				++errCont;
			}
		} else {
			// 重测代理并多错误次数计数
			proxyTest(index);
		}
	});
	log(`尝试使用代理访问\t${ url }`);
	var timer = new Date();
}

function log(msg) {
	function fmtd(d) {
		return `${ d < 10 ? "0" : "" }${ d }`;
	}
	var time = new Date();
	msg = `[${ fmtd(time.getHours()) }:${ fmtd(time.getMinutes()) }:${ fmtd(time.getSeconds()) }] ${ String(msg).replace(/\b(\w+\:\/+[^\/]+\/?)\S*/, "$1") }`;
	console.log(msg);
}

process.on("uncaughtException", err => {
	console.error(`Caught exception: ${err}`);
});

getInfos();
log("启动成功，正在寻找免费帐号");
