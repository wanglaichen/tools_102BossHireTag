import json

from flask import Flask, Response, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from config import AppConfig
from services.company_service import CompanyService


app = Flask(__name__)
app.config.from_object(AppConfig)

company_service = CompanyService.from_app_config(app.config)


@app.errorhandler(ValueError)
def handle_value_error(error):
    return jsonify({"message": str(error)}), 400


@app.errorhandler(HTTPException)
def handle_http_error(error):
    if request.path.startswith("/api/"):
        return jsonify({"message": error.description}), error.code
    return error


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    app.logger.exception("Unhandled error")
    if request.path.startswith("/api/"):
        return jsonify({"message": str(error)}), 500
    raise error


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/summary", methods=["GET"])
def summary():
    return jsonify(company_service.get_summary())


@app.route("/api/companies", methods=["GET"])
def list_companies():
    return jsonify({"items": company_service.list_companies()})


@app.route("/api/companies", methods=["POST"])
def create_company():
    payload = request.get_json(silent=True) or {}
    item = company_service.create_company(payload)
    return jsonify(
        {
            "message": "记录已新增",
            "item": item,
            "summary": company_service.get_summary(),
        }
    )


@app.route("/api/companies/import", methods=["POST"])
def import_companies():
    payload = request.get_json(silent=True) or {}
    result = company_service.import_rows(payload.get("text", ""))
    return jsonify(
        {
            "message": f"导入 {result['imported_count']} 条，更新 {result['updated_count']} 条，跳过 {result['skipped_count']} 条",
            **result,
        }
    )


@app.route("/api/companies/export.csv", methods=["GET"])
def export_companies_csv():
    body = "\ufeff" + company_service.export_csv()
    return Response(
        body,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=resume-company-tags.csv"},
    )


@app.route("/api/companies/export.json", methods=["GET"])
def export_companies_json():
    body = json.dumps({"items": company_service.list_companies()}, ensure_ascii=False, indent=2)
    return Response(
        body,
        mimetype="application/json; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=resume-company-tags.json"},
    )


@app.route("/api/companies/<company_id>", methods=["PATCH"])
def update_company(company_id: str):
    payload = request.get_json(silent=True) or {}
    item = company_service.update_company(company_id, payload)
    return jsonify(
        {
            "message": "记录已更新",
            "item": item,
            "summary": company_service.get_summary(),
        }
    )


@app.route("/api/companies/<company_id>", methods=["DELETE"])
def delete_company(company_id: str):
    result = company_service.delete_company(company_id)
    return jsonify(
        {
            "message": "记录已删除",
            **result,
            "summary": company_service.get_summary(),
        }
    )


if __name__ == "__main__":
    app.run(debug=True, host=app.config["APP_HOST"], port=app.config["APP_PORT"])
