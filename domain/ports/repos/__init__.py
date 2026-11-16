"""永続化リポジトリの抽象ポート群（領域別分割モジュールの再エクスポート入口）。"""

from domain.ports.repos.base import IGuildScopedRepo
from domain.ports.repos.bundle import IRepositoryBundle
from domain.ports.repos.economy import IAssetRepo, IGuildRepo, INoticeRepo, IRecordRepo, IWalletRepo
from domain.ports.repos.games import (
    IArenaRepo,
    IEventRepo,
    IHorseRepo,
    IPachinkoRepo,
    IRaceRepo,
    IRelicRepo,
    IRtpRepo,
)
from domain.ports.repos.market import (
    IBondRepo,
    ICryptoRepo,
    IEarningsRepo,
    IMarginRepo,
    IMarketDataRepo,
    IMarketEventRepo,
    IOptionRepo,
)
from domain.ports.repos.social import (
    IAuctionRepo,
    ICompanyRepo,
    IEscrowRepo,
    ILaborRepo,
    IP2PRepo,
    IQuizRepo,
    IRaffleRepo,
    IShopRepo,
)
from domain.ports.repos.teiai import IBankRepo, IDebtRepo, ILoanRepo

__all__ = [
    "IArenaRepo",
    "IAssetRepo",
    "IAuctionRepo",
    "ICompanyRepo",
    "IBankRepo",
    "IBondRepo",
    "ICryptoRepo",
    "IDebtRepo",
    "IEarningsRepo",
    "IEscrowRepo",
    "IEventRepo",
    "IGuildRepo",
    "IGuildScopedRepo",
    "IHorseRepo",
    "ILaborRepo",
    "ILoanRepo",
    "IMarginRepo",
    "IMarketDataRepo",
    "IMarketEventRepo",
    "INoticeRepo",
    "IOptionRepo",
    "IP2PRepo",
    "IPachinkoRepo",
    "IQuizRepo",
    "IRaceRepo",
    "IRaffleRepo",
    "IRecordRepo",
    "IRelicRepo",
    "IRepositoryBundle",
    "IRtpRepo",
    "IShopRepo",
    "IWalletRepo",
]
