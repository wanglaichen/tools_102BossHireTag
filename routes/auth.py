"""Auth and admin-on-user import/export routes."""
from __future__ import annotations

import json
from pathlib import Path

from flask import Blueprint, Response, g, jsonify, request

from config import AppConfig
from routes.deps import get_auth, require_admin
from services.account_bundle import export_account_bundle, import_account_bundle
from services.account_factory import blacklist_for_account, drop_account_caches, service_for_account
from services.auth_service import AuthError

bp = Blueprint("auth", __name__)

@bp.route("/api/auth/register", methods=["POST"])
def auth_register():
    payload = request.get_json(silent=True) or {}
    try:
        result = get_auth().register_account(
            payload.get("username", ""),
            payload.get("password", ""),
            payload.get("displayName"),
        )
    except ValueError as error:
        status = 409 if "已存在" in str(error) else 400
        return jsonify({"message": str(error)}), status
    return jsonify({"message": "注册成功", **result}), 201


@bp.route("/api/auth/login", methods=["POST"])
def auth_login():
    payload = request.get_json(silent=True) or {}
    if payload.get("username"):
        result = get_auth().login_with_password(payload.get("username", ""), payload.get("password", ""))
        return jsonify({"message": "登录成功", **result})
    result = get_auth().login_with_code(payload.get("code", ""))
    account = get_auth().ensure_wechat_user(result["user"]["openid"])
    get_auth().assert_user_accessible(account)
    return jsonify({"message": "登录成功", **result, "user": get_auth().public_user(account)})


@bp.route("/api/auth/registration-policy/public", methods=["GET"])
def auth_registration_policy_public():
    return jsonify({"trialHours": get_auth().get_self_register_trial_hours()})


@bp.route("/api/auth/registration-policy", methods=["GET"])
def auth_registration_policy_get():
    require_admin()
    auth = get_auth()
    return jsonify(
        {
            "trialHours": auth.get_self_register_trial_hours(),
            "defaultTrialHours": auth.DEFAULT_SELF_REGISTER_TRIAL_HOURS,
        }
    )


@bp.route("/api/auth/registration-policy", methods=["PUT"])
def auth_registration_policy_put():
    require_admin()
    payload = request.get_json(silent=True) or {}
    trial_hours = get_auth().set_self_register_trial_hours(payload.get("trialHours"))
    return jsonify(
        {
            "trialHours": trial_hours,
            "defaultTrialHours": get_auth().DEFAULT_SELF_REGISTER_TRIAL_HOURS,
            "message": "试用策略已更新",
        }
    )


@bp.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    token = get_auth()._bearer_token(request.headers.get("Authorization"))
    get_auth().delete_session(token)
    return jsonify({"ok": True})


@bp.route("/api/auth/me", methods=["GET"])
def auth_me():
    return jsonify({"user": get_auth().public_user(g.account)})


@bp.route("/api/auth/change-password", methods=["POST"])
def auth_change_password():
    payload = request.get_json(silent=True) or {}
    user = get_auth().change_password(g.account["id"], payload.get("oldPassword", ""), payload.get("newPassword", ""))
    return jsonify({"user": user, "message": "密码已更新"})


def require_admin() -> dict:
    if g.account.get("role") != "admin":
        raise AuthError("仅管理员可操作", 403)
    return g.account


@bp.route("/api/auth/users", methods=["GET"])
def auth_list_users():
    require_admin()
    auth = get_auth()
    trial_hours = auth.get_self_register_trial_hours()
    return jsonify(
        {
            "users": auth.list_users(),
            "registrationPolicy": {
                "trialHours": trial_hours,
                "defaultTrialHours": auth.DEFAULT_SELF_REGISTER_TRIAL_HOURS,
            },
        }
    )


@bp.route("/api/auth/users", methods=["POST"])
def auth_create_user():
    require_admin()
    payload = request.get_json(silent=True) or {}
    try:
        user = get_auth().create_user(
            username=payload.get("username", ""),
            password=payload.get("password", ""),
            display_name=payload.get("displayName"),
            role=payload.get("role") or "user",
            source="admin",
            apply_trial=False,
        )
    except ValueError as error:
        status = 409 if "已存在" in str(error) else 400
        return jsonify({"message": str(error)}), status
    return jsonify({"user": get_auth().public_user(user), "message": "账号已创建"}), 201


@bp.route("/api/auth/users/<user_id>", methods=["PUT"])
def auth_update_user(user_id: str):
    payload = request.get_json(silent=True) or {}
    user = get_auth().update_user(g.account, user_id, payload)
    return jsonify({"user": user, "message": "账号已更新"})


@bp.route("/api/auth/users/<user_id>", methods=["DELETE"])
def auth_delete_user(user_id: str):
    get_auth().delete_user(g.account, user_id)
    drop_account_caches(user_id)
    return jsonify({"ok": True, "message": "账号已删除"})


def _bundle_download(result: dict) -> Response:
    body = json.dumps(result["payload"], ensure_ascii=False, indent=2) + "\n"
    return Response(
        body,
        mimetype="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={result['filename']}"},
    )


@bp.route("/api/account/bundle", methods=["GET"])
def account_export_bundle():
    """当前登录账号导出全部业务数据（迁移用）。"""
    result = export_account_bundle(g.account, public_account=get_auth().public_user(g.account))
    return _bundle_download(result)


@bp.route("/api/account/bundle/import", methods=["POST"])
def account_import_bundle():
    """当前账号增量导入全部数据包。"""
    payload = request.get_json(silent=True) or {}
    result = import_account_bundle(g.account, payload.get("text", ""), overwrite=False)
    return jsonify(result)


@bp.route("/api/account/bundle/import-overwrite", methods=["POST"])
def account_import_bundle_overwrite():
    """当前账号覆盖导入全部数据包。"""
    payload = request.get_json(silent=True) or {}
    result = import_account_bundle(g.account, payload.get("text", ""), overwrite=True)
    return jsonify(result)


@bp.route("/api/auth/users/<user_id>/export", methods=["GET"])
@bp.route("/api/auth/users/<user_id>/bundle", methods=["GET"])
def auth_export_user_backup(user_id: str):
    """管理员导出指定账号的全部业务数据（登记/忽略/黑名单/关注/岗位更新）。"""
    require_admin()
    target = get_auth().read_user(user_id)
    if not target:
        raise AuthError("用户不存在", 404)
    result = export_account_bundle(target, public_account=get_auth().public_user(target))
    return _bundle_download(result)


@bp.route("/api/auth/users/<user_id>/export.csv", methods=["GET"])
def auth_export_user_csv(user_id: str):
    """管理员导出指定账号的登记公司 CSV（不含账号敏感字段）。"""
    require_admin()
    target = get_auth().read_user(user_id)
    if not target:
        raise AuthError("用户不存在", 404)
    service = service_for_account(target)
    body = service.export_csv()
    username = str(target.get("username") or "account")
    safe = "".join(ch for ch in username if ch.isalnum() or ch in "._-") or "account"
    return Response(
        body.encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={safe}-hire-companies.csv"},
    )


@bp.route("/api/auth/users/<user_id>/import", methods=["POST"])
@bp.route("/api/auth/users/<user_id>/bundle/import", methods=["POST"])
def auth_import_user_backup(user_id: str):
    """管理员向指定账号增量导入全部数据包（兼容旧公司备份）。"""
    require_admin()
    target = get_auth().read_user(user_id)
    if not target:
        raise AuthError("用户不存在", 404)
    payload = request.get_json(silent=True) or {}
    result = import_account_bundle(target, payload.get("text", ""), overwrite=False)
    return jsonify(
        {
            **result,
            "message": f"已增量导入到账号「{target.get('username')}」：{result.get('message', '')}",
        }
    )


@bp.route("/api/auth/users/<user_id>/import-overwrite", methods=["POST"])
@bp.route("/api/auth/users/<user_id>/bundle/import-overwrite", methods=["POST"])
def auth_import_user_overwrite(user_id: str):
    """管理员向指定账号覆盖导入全部数据包（兼容旧公司备份）。"""
    require_admin()
    target = get_auth().read_user(user_id)
    if not target:
        raise AuthError("用户不存在", 404)
    payload = request.get_json(silent=True) or {}
    result = import_account_bundle(target, payload.get("text", ""), overwrite=True)
    return jsonify(
        {
            **result,
            "message": f"已覆盖导入到账号「{target.get('username')}」：{result.get('message', '')}",
        }
    )


@bp.route("/api/auth/users/<user_id>/ignored/export", methods=["GET"])
@bp.route("/api/auth/users/<user_id>/blacklist/export", methods=["GET"])
def auth_export_user_ignored(user_id: str):
    """管理员导出指定账号的忽略企业备份。"""
    require_admin()
    target = get_auth().read_user(user_id)
    if not target:
        raise AuthError("用户不存在", 404)
    service = blacklist_for_account(target)
    result = service.export_backup(account=get_auth().public_user(target))
    body = json.dumps(result["payload"], ensure_ascii=False, indent=2) + "\n"
    return Response(
        body,
        mimetype="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={result['filename']}"},
    )


@bp.route("/api/auth/users/<user_id>/ignored/export.csv", methods=["GET"])
@bp.route("/api/auth/users/<user_id>/blacklist/export.csv", methods=["GET"])
def auth_export_user_ignored_csv(user_id: str):
    """管理员导出指定账号的忽略企业 CSV。"""
    require_admin()
    target = get_auth().read_user(user_id)
    if not target:
        raise AuthError("用户不存在", 404)
    service = blacklist_for_account(target)
    body = service.export_csv()
    username = str(target.get("username") or "account")
    safe = "".join(ch for ch in username if ch.isalnum() or ch in "._-") or "account"
    return Response(
        body.encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={safe}-ignored.csv"},
    )


@bp.route("/api/auth/users/<user_id>/ignored/import", methods=["POST"])
@bp.route("/api/auth/users/<user_id>/blacklist/import", methods=["POST"])
def auth_import_user_ignored(user_id: str):
    """管理员向指定账号合并导入忽略企业。"""
    require_admin()
    target = get_auth().read_user(user_id)
    if not target:
        raise AuthError("用户不存在", 404)
    payload = request.get_json(silent=True) or {}
    service = blacklist_for_account(target)
    result = service.import_backup(payload.get("text", ""), overwrite=False)
    return jsonify(
        {
            "message": f"已导入忽略企业到账号「{target.get('username')}」：新增 {result['imported_count']}，更新 {result['updated_count']}",
            **result,
        }
    )


@bp.route("/api/auth/users/<user_id>/ignored/import-overwrite", methods=["POST"])
@bp.route("/api/auth/users/<user_id>/blacklist/import-overwrite", methods=["POST"])
def auth_import_user_ignored_overwrite(user_id: str):
    """管理员向指定账号覆盖导入忽略企业。"""
    require_admin()
    target = get_auth().read_user(user_id)
    if not target:
        raise AuthError("用户不存在", 404)
    payload = request.get_json(silent=True) or {}
    service = blacklist_for_account(target)
    result = service.import_backup(payload.get("text", ""), overwrite=True)
    return jsonify(
        {
            "message": f"已覆盖导入忽略企业到账号「{target.get('username')}」：{result['imported_count']} 条",
            **result,
        }
    )

