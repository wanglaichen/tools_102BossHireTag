"""Register Flask blueprints."""
from __future__ import annotations

from flask import Flask


def register_blueprints(app: Flask) -> None:
    from routes.admin import bp as admin_bp
    from routes.auth import bp as auth_bp
    from routes.blacklist import bp as blacklist_bp
    from routes.blocklist import bp as blocklist_bp
    from routes.channels import bp as channels_bp
    from routes.companies import bp as companies_bp
    from routes.job_updates import bp as job_updates_bp
    from routes.proxy import bp as proxy_bp
    from routes.settings import bp as settings_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(channels_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(companies_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(blacklist_bp)
    app.register_blueprint(blocklist_bp)
    app.register_blueprint(job_updates_bp)
    app.register_blueprint(proxy_bp)
