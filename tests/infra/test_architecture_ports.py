"""水平ポート契約（名目的基底クラス・Bridge・Constructor DI）とレイヤ境界の自動ガードレールテスト。"""

import ast
import subprocess
import sys
from pathlib import Path

import pytest

from domain.ports import repos as repo_ports
from infra.db.repositories import RepositoryBundle, open_repositories

ROOT = Path(__file__).resolve().parents[2]


def _iter_py(rel: str):
    return sorted((ROOT / rel).rglob("*.py"))


def _imported_modules(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    mods: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods.append(node.module)
    return mods


def test_domain_ports_import_does_not_require_catalogs():
    """domain.ports はカタログバインド前でも MRO 衝突なく単独 import できる。"""
    proc = subprocess.run(
        [sys.executable, "-c", "import domain.ports"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr


def test_legacy_facade_and_service_locators_are_removed():
    """旧 Economy ファサード・cog_ports・旧プロトコル群が削除されている。"""
    assert not (ROOT / "infra/db/economy.py").exists()
    assert not (ROOT / "cogs/shared/cog_ports.py").exists()
    for removed in ("core.py", "casino.py", "community.py", "economy.py", "horse.py", "labor.py", "market.py"):
        assert not (ROOT / "domain/ports" / removed).exists()


def test_ports_and_bridges_use_nominal_base_classes_without_protocol_or_abc():
    """domain/ports/（catalogs 除く）と bridges.py は Protocol・abc.ABC を使わない名目的基底クラスである。"""
    targets = [p for p in _iter_py("domain/ports") if p.name not in ("catalogs.py",) and "catalog_types" not in p.parts]
    targets.append(ROOT / "cogs/shared/bridges.py")
    violations: list[str] = []
    for path in targets:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for base in node.bases:
                    base_id = base.id if isinstance(base, ast.Name) else getattr(base, "attr", "")
                    if base_id in ("Protocol", "ABC"):
                        violations.append(
                            f"{path.relative_to(ROOT)}:{node.lineno} class {node.name} inherits {base_id}"
                        )
            elif isinstance(node, ast.ImportFrom) and node.module in ("abc",):
                violations.append(f"{path.relative_to(ROOT)}:{node.lineno} imports abc")
    assert not violations, "\n".join(violations)


@pytest.mark.real_scope
def test_repository_bundle_satisfies_nominal_repo_ports():
    """open_repositories() が返す全リポジトリは domain.ports.repos の名目的基底クラスを継承する。"""
    repos = open_repositories(":memory:", strict=True)
    try:
        assert isinstance(repos, repo_ports.IRepositoryBundle)
        assert isinstance(repos, RepositoryBundle)
        assert isinstance(repos.wallet, repo_ports.IWalletRepo)
        assert isinstance(repos.escrow, repo_ports.IEscrowRepo)
        assert isinstance(repos.records, repo_ports.IRecordRepo)
        assert isinstance(repos.guild, repo_ports.IGuildRepo)
        assert isinstance(repos.bank, repo_ports.IBankRepo)
        assert isinstance(repos.debt, repo_ports.IDebtRepo)
        assert isinstance(repos.shop, repo_ports.IShopRepo)
        assert isinstance(repos.p2p, repo_ports.IP2PRepo)
        assert isinstance(repos.horses, repo_ports.IHorseRepo)
        assert isinstance(repos.races, repo_ports.IRaceRepo)
        assert isinstance(repos.arena, repo_ports.IArenaRepo)

        scoped = repos.for_guild(1)
        assert scoped.wallet.balance(1) > 0
        assert scoped.shop.inventory(1) == {}
        assert scoped.horses.horse_list(1) == []
    finally:
        repos.close()


def test_domain_has_no_outward_dependencies():
    """domain/ は infra・services・cogs・discord に依存しない。"""
    forbidden = ("infra", "services", "cogs", "discord")
    violations: list[str] = []
    for path in _iter_py("domain"):
        for mod in _imported_modules(path):
            top = mod.split(".")[0]
            if top in forbidden:
                violations.append(f"{path.relative_to(ROOT)} imports {mod}")
    assert not violations, "\n".join(violations)


def test_services_no_infra_db_cogs_or_any_economy():
    """services/ は infra.db・cogs・discord に依存せず、economy を Any 型にしない。"""
    violations: list[str] = []
    for path in _iter_py("services"):
        for mod in _imported_modules(path):
            if mod == "infra.db" or mod.startswith("infra.db.") or mod.split(".")[0] in ("cogs", "discord"):
                violations.append(f"{path.relative_to(ROOT)} imports {mod}")

        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
                    if arg.arg in ("economy", "_economy", "eco") and isinstance(arg.annotation, ast.Name):
                        if arg.annotation.id == "Any":
                            violations.append(f"{path.relative_to(ROOT)}:{node.lineno} param {arg.arg}: Any")
            elif isinstance(node, ast.AnnAssign) and isinstance(node.annotation, ast.Name):
                target = node.target
                name = target.attr if isinstance(target, ast.Attribute) else getattr(target, "id", "")
                if name in ("economy", "_economy", "eco") and node.annotation.id == "Any":
                    violations.append(f"{path.relative_to(ROOT)}:{node.lineno} attr {name}: Any")
    assert not violations, "\n".join(violations)


def test_cogs_no_infra_db_imports_and_no_service_locators():
    """cogs/ は infra.db を import せず、bot.economy や旧 Service Locator を一切使わない。"""
    forbidden_names = {"port_of", "guild_port", "get_cog_port", "require_cog_port", "services_of"}
    violations: list[str] = []
    for path in _iter_py("cogs"):
        rel = path.relative_to(ROOT)
        for mod in _imported_modules(path):
            if mod == "infra.db" or mod.startswith("infra.db.") or "cog_ports" in mod:
                violations.append(f"{rel} imports {mod}")

        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr == "economy":
                val = node.value
                if (isinstance(val, ast.Name) and val.id == "bot") or (
                    isinstance(val, ast.Attribute) and val.attr == "bot"
                ):
                    violations.append(f"{rel}:{node.lineno} accesses *.economy directly")
            elif isinstance(node, ast.Name) and node.id in forbidden_names:
                violations.append(f"{rel}:{node.lineno} uses locator {node.id}")
    assert not violations, "\n".join(violations)


def test_production_follows_python_coding_conventions():
    """本番コード全体で abc.ABC / @abstractmethod / Protocol / @staticmethod / 不要な @classmethod を禁止する。"""
    allowed_classmethod_methods = {"from_custom_id"}
    targets = [
        *[p for folder in ("domain", "services", "infra", "cogs") for p in _iter_py(folder)],
        ROOT / "main.py",
        ROOT / "manage.py",
    ]
    violations: list[str] = []
    for path in targets:
        rel = path.relative_to(ROOT)
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) and any(a.name == "abc" for a in node.names):
                violations.append(f"{rel}:{node.lineno} imports abc")
            elif isinstance(node, ast.ImportFrom) and node.module == "abc":
                violations.append(f"{rel}:{node.lineno} imports from abc")
            elif isinstance(node, ast.ClassDef):
                for base in node.bases:
                    base_name = base.id if isinstance(base, ast.Name) else getattr(base, "attr", "")
                    if base_name in ("Protocol", "ABC"):
                        violations.append(f"{rel}:{node.lineno} class {node.name}({base_name})")
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for dec in node.decorator_list:
                    dec_str = ast.unparse(dec)
                    if "abstractmethod" in dec_str:
                        violations.append(f"{rel}:{node.lineno} @{dec_str} on {node.name}")
                    elif "staticmethod" in dec_str:
                        violations.append(f"{rel}:{node.lineno} @staticmethod on {node.name}")
                    elif "classmethod" in dec_str and node.name not in allowed_classmethod_methods:
                        violations.append(f"{rel}:{node.lineno} @classmethod on {node.name}")
    assert not violations, "\n".join(violations)
