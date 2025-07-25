import type nt from '@wallet/nekoton-wasm'
import {
    action, autorun, makeAutoObservable, runInAction,
} from 'mobx'
import { Disposable, injectable } from 'tsyringe'

import {
    AccountabilityStore, RpcStore, TokensManifestItem, TokensStore,
} from '@app/popup/modules/shared'
import { ConnectionDataItem, PendingApproval } from '@app/models'

import { ApprovalStore } from '../../store'

@injectable()
export class ApproveAddAssetViewModel implements Disposable {

    public balance = ''

    public loading = false

    private disposer: () => void

    constructor(
        private rpcStore: RpcStore,
        private approvalStore: ApprovalStore,
        private accountability: AccountabilityStore,
        private tokensStore: TokensStore,
    ) {
        makeAutoObservable(this, undefined, { autoBind: true })

        this.disposer = autorun(() => {
            const { tokenWallet } = this.approval.requestData.details

            this.rpcStore.rpc.getTokenWalletBalance(tokenWallet)
                .then(action(balance => {
                    this.balance = balance
                }))
                .catch(action(() => {
                    this.balance = '0'
                }))
        })
    }

    public dispose(): void | Promise<void> {
        this.disposer()
    }

    public get approval(): PendingApproval<'addTip3Token'> {
        return this.approvalStore.approval as PendingApproval<'addTip3Token'>
    }

    public get selectedConnection(): ConnectionDataItem {
        return this.rpcStore.state.selectedConnection
    }

    public get account(): nt.AssetsList | undefined {
        return Object.values(this.accountability.accountEntries).find(
            account => account.tonWallet.address === this.approval.requestData.account,
        )
    }

    public get tokensMeta(): Record<string, TokensManifestItem> {
        return this.tokensStore.meta
    }

    public get manifestData(): TokensManifestItem {
        return this.tokensMeta[this.approval.requestData.details.address]
    }

    public get knownTokens(): Record<string, nt.Symbol> {
        return this.rpcStore.state.knownTokens
    }

    public get phishingAttempt(): PhishingAttempt | undefined {
        const additionalAssets = this.account!.additionalAssets[this.selectedConnection.group]?.tokenWallets ?? []
        const { details } = this.approval.requestData
        let phishingAttempt: PhishingAttempt | undefined,
            existingToken = ExistingToken.None

        if (this.tokensMeta) {
            for (const { rootTokenContract } of additionalAssets) {
                const info = this.knownTokens[rootTokenContract] as nt.Symbol | undefined

                if (info == null || info.name !== details.symbol) {
                    continue
                }

                existingToken = this.tokensMeta[info.rootTokenContract]
                    ? ExistingToken.Trusted : ExistingToken.Untrusted
                break
            }
        }

        for (const info of Object.values(this.tokensMeta || {})) {
            if (info.symbol === details.symbol && info.address !== details.address) {
                phishingAttempt = PhishingAttempt.Explicit
                break
            }
        }

        if (existingToken === ExistingToken.Untrusted && this.manifestData) {
            phishingAttempt = PhishingAttempt.Suggestion
        }
        else if (existingToken !== ExistingToken.None) {
            phishingAttempt = PhishingAttempt.SameSymbol
        }

        return phishingAttempt
    }

    public async onReject(): Promise<void> {
        this.loading = true
        await this.approvalStore.rejectPendingApproval()
    }

    public async onSubmit(): Promise<void> {
        this.loading = true

        try {
            await this.approvalStore.resolvePendingApproval({})
        }
        finally {
            runInAction(() => {
                this.loading = false
            })
        }
    }

}

export enum TokenNotificationType {
    Error,
    Warning,
}

export enum PhishingAttempt {
    Explicit,
    SameSymbol,
    Suggestion,
}

export enum ExistingToken {
    None,
    Trusted,
    Untrusted,
}
