# tools_102BossHireTag

简历投递公司标记工具，用来记录投递过的企业、沟通效果、行业、是否猎头和备注。界面按 Excel 表格习惯设计，支持单条新增、编辑、删除、批量粘贴导入、筛选搜索，以及导出 CSV/JSON。

## 功能

- 记录字段：企业名称、效果状态、行业、是否是猎头、备注。
- 支持从 Excel 复制多行直接粘贴导入，列顺序为：企业名称、效果状态、行业、是否是猎头、备注。
- 同名企业导入时会更新原记录，避免重复。
- 支持按关键字、效果状态、猎头类型筛选。
- 支持导出 CSV 和 JSON。
- 优先使用 Redis 存储，key 统一放在 `jjob/tools102-boss-hire-tag/` 前缀下。
- 未配置 Redis 时回退到本地 `data/companies.json`，方便本地开发。
- 支持通过环境变量设置进程代理。
- 使用 Git tag 自动发布到 Vercel。

## 技术栈

- Python 3
- Flask
- Redis
- Bootstrap 5
- Vercel
- GitHub Actions

## 本地运行

安装依赖：

```bash
pip install -r requirements.txt
```

复制配置：

```bash
cp env.example .env
```

填写 `.env`：

```env
APP_HOST=0.0.0.0
APP_PORT=9212
REDIS_URL=你的 Redis 连接串
REDIS_KEY_PREFIX=jjob/tools102-boss-hire-tag
REDIS_TIMEOUT_SECONDS=5
```

`STORAGE_BACKEND` 支持：

```text
auto  有 REDIS_URL 时用 Redis，否则用本地 JSON
redis 强制使用 Redis，未配置 REDIS_URL 会报错
json  强制使用本地 JSON
```

启动：

```bash
python app.py
```

打开：

```text
http://localhost:9212
```

也可以使用脚本启动：

```bash
./start.sh
```

## 代理配置

如果部署或本地进程需要走代理，可以设置：

```env
APP_PROXY_URL=http://127.0.0.1:7890
```

启动时会自动补齐：

```text
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
http_proxy
https_proxy
all_proxy
```

也可以直接配置这些标准代理变量。

## Vercel 环境变量

生产环境不要把 Redis 密钥写进代码。需要在 Vercel 项目里配置：

```text
REDIS_URL
REDIS_KEY_PREFIX=jjob/tools102-boss-hire-tag
```

如需代理，也可以配置：

```text
APP_PROXY_URL
```

## GitHub Actions 发布

仓库需要配置以下 Actions Secrets：

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

发布方式：

```bash
git tag v1.0.0
git push origin v1.0.0
```

`.github/workflows/main.yml` 会在 `v*` tag 推送后执行 Vercel Production 部署。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/summary` | 汇总数量和筛选选项 |
| `GET` | `/api/companies` | 公司记录列表 |
| `POST` | `/api/companies` | 新增公司记录 |
| `PATCH` | `/api/companies/<id>` | 更新公司记录 |
| `DELETE` | `/api/companies/<id>` | 删除公司记录 |
| `POST` | `/api/companies/import` | 批量粘贴导入 |
| `GET` | `/api/companies/export.csv` | 导出 CSV |
| `GET` | `/api/companies/export.json` | 导出 JSON |
