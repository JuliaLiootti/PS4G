import type { NetworkGroup } from '@app/models'

export const ENVIRONMENT_TYPE_POPUP = 'popup'
export const ENVIRONMENT_TYPE_NOTIFICATION = 'notification'
export const ENVIRONMENT_TYPE_FULLSCREEN = 'fullscreen'
export const ENVIRONMENT_TYPE_BACKGROUND = 'background'
export const ENVIRONMENT_TYPE_PHISHING_WARNING = 'phishing-warning'

export type Environment =
    | typeof ENVIRONMENT_TYPE_POPUP
    | typeof ENVIRONMENT_TYPE_NOTIFICATION
    | typeof ENVIRONMENT_TYPE_FULLSCREEN
    | typeof ENVIRONMENT_TYPE_BACKGROUND
    | typeof ENVIRONMENT_TYPE_PHISHING_WARNING;

export const CONTENT_SCRIPT = 'nekoton-contentscript'
export const INPAGE_SCRIPT = 'nekoton-inpage'
export const NEKOTON_PROVIDER = 'nekoton-provider'
export const NEKOTON_CONTROLLER = 'nekoton-controller'
export const STANDALONE_CONTROLLER = 'standalone-controller'
export const STANDALONE_PROVIDER = 'standalone-provider'
export const PHISHING_SAFELIST = 'phishing-safelist'
export const PHISHING = 'phishing'

export const NATIVE_CURRENCY = 'EVER'
export const NATIVE_CURRENCY_DECIMALS = 9

export const MULTISIG_UNCONFIRMED_LIMIT = 5

export const TOKENS_MANIFEST_URL = 'https://raw.githubusercontent.com/broxus/ton-assets/master/manifest.json'
export const TOKENS_MANIFEST_REPO = 'https://github.com/broxus/ton-assets'

export const LEDGER_BRIDGE_URL = 'https://broxus.github.io/everscale-ledger-bridge'

export const BUY_EVER_URL = 'https://buy.everwallet.net/'

export const ST_EVER = 'STEVER'
export const ST_EVER_DECIMALS = 9

export const STAKE_APY_PERCENT = 12
export const STAKE_REMOVE_PENDING_WITHDRAW_AMOUNT = '2000000000' // 2 EVER
export const STAKE_DEPOSIT_ATTACHED_AMOUNT = '2000000000' // 2 EVER
export const STAKE_WITHDRAW_ATTACHED_AMOUNT = '3000000000' // 3 EVER
export const STAKE_TUTORIAL_URL = '#' // TODO

export const BROXUS_BLOCKLIST_URL = 'https://raw.githubusercontent.com/broxus/ever-wallet-anti-phishing/master/blacklist.json'

export const BROXUS_NFT_COLLECTIONS_LIST_URL = 'https://raw.githubusercontent.com/broxus/nft-lists/master/ever-wallet-default.json'

export const FLATQUBE_API_BASE_PATH = 'https://api.flatqube.io/v1'

export const WALLET_TERMS_URL = 'https://l1.broxus.com/everscale/wallet/terms'

export const ST_EVER_VAULT_ADDRESS_CONFIG: Partial<Record<NetworkGroup, string>> = {
    mainnet: '0:675a6d63f27e3f24d41d286043a9286b2e3eb6b84fa4c3308cc2833ef6f54d68',
}

export const ST_EVER_TOKEN_ROOT_ADDRESS_CONFIG: Partial<Record<NetworkGroup, string>> = {
    mainnet: '0:6d42d0bc4a6568120ea88bf642edb653d727cfbd35868c47877532de128e71f2',
}

export const DENS_ROOT_ADDRESS_CONFIG: Partial<Record<string, string>> = {
    mainnet: '0:a7d0694c025b61e1a4a846f1cf88980a5df8adf737d17ac58e35bf172c9fca29',
    testnet: '0:10086efad85fc0168d4090bc29bed834774d9603278e24e3bdbcf0ba3fdd9e45',
}
