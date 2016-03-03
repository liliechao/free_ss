#!/usr/bin/env node

"use strict";

// 可以抓取SS账号的网页，及其CSS选择符
const srvs = {
	"http://www.ishadowsocks.com/": "#free .col-lg-4.text-center",
	// "http://sskuai.pw/": ".container .inner p",
};
const strategy = "com.shadowsocks.strategy.ha";
var hasChange;
const configPath = require("path").join(__dirname, "gui-config.json");
var config;
var reqCount = 0;
var reqDone = 0;
var childProcess;

// 中文所对应的配置项key名
const keyMap = {
	"IP": "server",
	"加密方式": "method",
	"密码": "password",
	"服务器地址": "server",
	"服务地址": "server",
	"服务密码": "password",
	"服务端口": "server_port",
	"端口": "server_port",
};

function getInfos() {
	hasChange = false;
	require("fs").readFile(configPath, (err, data) => {
		if (!err) {
			// 本地无配置，自行生成
			try {
				data = JSON.parse(data);
			} catch (ex) {
				try {
					data = eval.call(null, "(" + data + ")");
				} catch (ex) {
					data = null;
				}
			}
			if (data) {
				config = data;
				upObj(config, {
					// 配置为自动选择服务器
					"index": -1,
					// 若未配置服务器选择算法，则将其配置为“高可用”
					"strategy": config.strategy || strategy
				});
			}
		}
		config = config || {
			"strategy": strategy,
			"index": -1,
			"global": false,
			"configs": [],
			"shareOverLan": true,
			"localPort": 1080
		};

		for (var url in srvs) {
			// 统计服务器数量
			reqCount++;
			getInfo(url, srvs[url]);
		}
	});
}

function runShadowsocks() {
	// 重新启动Shadowsocks
	const child_process = require("child_process");
	log(`已${ childProcess ? "重启" : "启动" }Shadowsocks`);
	childProcess = child_process.exec("taskkill /f /im Shadowsocks.exe&&taskkill /f /im ss_privoxy.exe", () => {
		childProcess = child_process.execFile("Shadowsocks.exe");
		childProcess.on("close", () => {
			setTimeout(runShadowsocks, 3000);
		});
		setTimeout(proxyTester, 3000);
	});
}


function upObj(objOld, objNew) {
	for (var key in objNew) {
		if (String(objOld[key]) !== String(objNew[key])) {
			objOld[key] = objNew[key];
			hasChange = true;
		}
	}
}

function getInfo(url, selector) {

	// 请求远程数据
	require("jsdom").env({
		url: url,
		done: (err, window) => {
			// 统计线程
			reqDone++;
			if (!err) {
				// 将DOM元素转化为服务器配置信息
				var svrs = Array.prototype.slice.call(window.document.querySelectorAll(selector), 0).map((node) => {
					// 提取dom元素中的信息
					var text = (node.innerText || node.textContent).trim();
					if (/\n/.test(text)) {
						// 一般的正常情况，按换行符分隔字符串即可
						return text.split(/\s*\n\s*/g);
					} else {

						// 貌似jsDOM不支持innerText属性，所以采用分析子节点的办法
						return Array.prototype.slice.call(node.childNodes, 0).filter((node) => {
							return node.nodeType === 3;
						}).map((node) => {
							return (node.innerText || node.textContent).trim();
						});
					}
				}).map((infs, index) => {
					// 将提取到的信息，转为配置文件所需格式
					var server = {
						"server": "",
						"server_port": 0,
						"password": "",
						"method": "aes-256-cfb",
						"remarks": ""
					};

					// 遍历每行信息
					infs.forEach((inf) => {
						// 按冒号分隔字符串
						inf = inf.toLowerCase().split(/\s*[\:：]\s*/g);
						if (keyMap[inf[0]]) {
							// 根据中文提示，查字典找到配置项key名
							server[keyMap[inf[0]]] = inf[1];
						} else {
							// 字典中找不到的，按字符串查找方式匹配
							for (var key in keyMap) {
								if (inf[0].indexOf(key) > -1) {
									server[keyMap[key]] = inf[1];
									break;
								}
							}
						}
					});

					server.server_port = server.server_port - 0;

					// 根据url与index，为配置项编写remarks
					if (!server.remarks) {
						server.remarks = url.replace(/(?:^\w+\:\/+(?:www\.)?|\/.*$)/ig, "") + "/[" + index + "]";
					}
					return server;
				});
				if (svrs.length) {
					log(`${ url }\t获取到${ svrs.length }个服务器`);
				}

				svrs = svrs.filter((server) => {
					// 在已有配置中寻找remarks相同的配置项
					return !config.configs.some((cfgServer) => {
						if (cfgServer.remarks === server.remarks) {
							upObj(cfgServer, server);
							return true;
						}
					});
				});

				// 在配置文件中未找到的全新服务器，追加至配置
				if (svrs.length) {
					config.configs = config.configs.concat(svrs);
					hasChange = true;
				}
			}
			if (reqDone >= reqCount) {
				// 已完成所有网页抓取，准备后续工作
				if (hasChange) {
					// 配置信息有变化
					require("fs").writeFile(configPath, JSON.stringify(config, null, "\t"), (err) => {
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
					// 未更新配置，20秒后重测试代理
					setTimeout(proxyTester, 20000);
				} else {
					// 初始化
					runShadowsocks();
				}
			}
		}
	});
}

const url = "http://s3.amazonaws.com/psiphon/landing-page-redirect/redirect.html";
const origin = url.replace(/^(\w+\:\/+[^\/]+\/?).*$/, "$1");

function proxyTester(errCont) {
	var proxy = "http://127.0.0.1:" + (config.localPort || 1080) + (config.global ? "" : "/pac");
	log(`${ origin }\ttry`);
	// 使用代理尝试访问亚马逊
	require("request").defaults({
			proxy: proxy,
			maxSockets: Infinity,
			pool: {
				maxSockets: Infinity
			},
			timeout: 20000,
			time: true
		})
		.get(url)
		.on("response", (response) => {
			if (response.statusCode >= 200 && response.statusCode < 300 || response.statusCode === 304) {
				// 成功拿到facebook的响应，一切正常
				log(`${ origin }\tOK\t${ response.statusCode }`);
				// 代理正常，20秒后再试
				setTimeout(proxyTester, 20000);
			} else {
				err();
			}
		}).on("error", err);

	function err() {
		// 代理出错，统计出错次数
		errCont = errCont || 1;
		log(`${ origin }\tError\t${errCont} time(s).`);
		if (errCont > 2) {
			// 代理测试连续三次错误则重新拉取服务器信息
			getInfos();
		} else {
			// 重测代理并多错误次数计数
			proxyTester(++errCont);
		}
	}

}

function log(msg) {

	function fmtd(d) {
		return `${ d < 10 ? "0" : "" }${ d }`;
	}
	var time = new Date();
	console.log(`[${ time.getFullYear() }/${ time.getMonth()+1 }/${ time.getDate()+1 } ${ fmtd(time.getHours()) }:${ fmtd(time.getMinutes()) }:${ fmtd(time.getSeconds()) }]\t${ msg }`);
}


const cluster = require("cluster");

function work() {
	cluster.fork();
}

if (cluster.isMaster) {
	// Fork workers.
	cluster.on("exit", (worker) => {
		console.log(`进程 ${ worker.process.pid } 遇到未知错误，已重启`);
		setTimeout(work, 3000);
	});
	work();
} else {
	// 子进程中工作
	getInfos();
}