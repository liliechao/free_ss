free_ss
===============

> 免费[Shadowsocks](https://github.com/shadowsocks/shadowsocks-windows/tree/master)账号自动配置工具。

## 安装

1. 安装 [Node.js](https://nodejs.org/) 并 copy `free_ss.js`与`package.json`到`Shadowsocks.exe`所在目录。
1. 在管理员权限下，命令行运行 `npm i`。

## 使用

命令行运行`node free_ss.js`

## 功能
1. 自动同步`http://www.ishadowsocks.com/`上的免费账号至本地配置文件并重启Shadowsocks。
1. 使用代理轮流访问`amazonaws`、`google`、`youtube`、`facebook`的方式，监控代理运行情况，代理不正常时检查网页上的免费账号是否更新。
1. 代理长时间工作不正常时，自动重启Shadowsocks客户端
