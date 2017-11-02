#!/usr/bin/env node

"use strict";

// 可以抓取SS账号的网页，及其CSS选择符
const { JSDOM } = require("jsdom");
const srvs = {
	"http://www.yaozeyuan.online/whitelist/": "table",
	"https://freessr.win": ".text-center",
	"https://ss.ishadowx.net": "#portfolio .hover-text",
};

// 中文所对应的配置项key名
const keyMap = {
	"加密方式": "method",
	"服务器地址": "server",
	"服务地址": "server",
	"服务密码": "password",
	"服务器端口": "server_port",
	"服务端口": "server_port",
	"端口号": "server_port",
	"状态": "remarks",
	"ip address": "server",
	"port": "server_port",
};

function tabel2config (table) {
	const server = {};
	Array.from(table.querySelectorAll("tr")).forEach(tr => {
		if (tr.children.length === 2) {
			const key = getConfigKey(tr.children[0].innerHTML);
			const value = tr.children[1].innerHTML.trim();
			if (key && value) {
				server[key] = value;
			}
		}
	});
	return server;
}

function nodeText2config (node) {
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
	const server = {};

	// 遍历每行信息
	node.forEach(inf => {
		// 按冒号分隔字符串
		inf = inf.split(/\s*[:：]\s*/g);
		let key = getConfigKey(inf[0]);
		let val = inf[1];
		if (key && val) {
			server[key] = val;
		}
	});

	return server;
}

function node2config (node) {
	return node.tagName === "TABLE" ? tabel2config(node) : nodeText2config(node);
}

function getConfigKey (key) {
	if (!key) {
		return;
	}

	key = key.trim().toLowerCase();

	if (!keyMap[key]) {
		if (/^\w+$/.test(key)) {
			return key;
		}

		key = Object.keys(keyMap).find(keyName => (
			keyName.includes(key)
		));

		return key && keyMap[key];
	}
	return keyMap[key];
}

async function getServers () {
	return Promise.all(Object.keys(srvs).map(url => (
		JSDOM.fromURL(url, {
			referrer: url,
		}).then(dom => (
			Array.from(
				dom.window.document.querySelectorAll(srvs[url])
			).map(node2config)
		))
	))).then(servers => (
		[].concat.apply([], servers).filter(server => {
			if (server && server.server && server.password) {
				server.server_port = server.server_port ? +server.server_port : 443;
				server.server = server.server.toLowerCase();
				server.method = server.method ? server.method.toLowerCase() : "aes-256-cfb";
				return true;
			}
		})
	));
}

function format (servers) {
	if (!servers.length) {
		throw new Error("未找到任何服务器。");
	}
	if (process.argv.includes("--cow")) {
		return cow(servers);
	} else {
		return ss(servers);
	}
}

function ss (servers) {
	return JSON.stringify({
		index: -1,
		shareOverLan: true,
		strategy: "com.shadowsocks.strategy.ha",
		configs: servers.sort((server1, server2) => (
			server1.server.localeCompare(server2.server)
		)),
	}, 0, "\t");
}

function cow (servers) {
	let result = [
		"listen = http://0.0.0.0:1080",
		"loadBalance = latency",
		"",
	].concat(servers.map(server => (
		`proxy = ss://${server.method}:${server.password}@${server.server}:${server.server_port}`
	)).sort());
	return result.join("\n");
}

function getConfig () {
	return getServers().then(format);
}

if (process.mainModule === module) {
	getConfig().then(console.log, console.error);
}

module.exports = getConfig;
