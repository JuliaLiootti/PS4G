import Decimal from 'decimal.js'
import type nt from '@wallet/nekoton-wasm'

Decimal.set({ maxE: 500, minE: -500 })

export const parseError = (error: any): string => {
    if (typeof error?.message === 'string') {
        return error.message.replace(/Error: /gi, '')
    }

    return error?.toString?.().replace(/Error: /gi, '')
}

export const formatSeed = (seed: string) => seed?.split(/[, ;\r\n\t]+/g).filter(el => el !== '')

export const ignoreCheckPassword = (password: nt.KeyPassword) => password.type !== 'ledger_key' && password.data.password == null

export type PrepareKeyParams = {
    keyEntry: nt.KeyStoreEntry
    wallet: nt.ContractType
    password?: string
    context?: nt.LedgerSignatureContext
    cache?: boolean
};

export const prepareKey = ({
    keyEntry,
    password,
    context,
    cache,
    wallet,
}: PrepareKeyParams): nt.KeyPassword => {
    switch (keyEntry.signerName) {
        case 'encrypted_key': {
            return {
                type: keyEntry.signerName,
                data: {
                    publicKey: keyEntry.publicKey,
                    password: password || undefined,
                    cache,
                },
            } as nt.KeyPassword
        }

        case 'master_key': {
            return {
                type: keyEntry.signerName,
                data: {
                    masterKey: keyEntry.masterKey,
                    publicKey: keyEntry.publicKey,
                    password: password || undefined,
                    cache,
                },
            }
        }

        case 'ledger_key': {
            return {
                type: keyEntry.signerName,
                data: {
                    publicKey: keyEntry.publicKey,
                    context: wallet === 'SetcodeMultisigWallet24h' || wallet === 'HighloadWalletV2'
                        ? undefined
                        : context,
                    wallet,
                },
            }
        }

        default:
            throw new Error(`Unknown signer name: ${keyEntry?.signerName}`)
    }
}
