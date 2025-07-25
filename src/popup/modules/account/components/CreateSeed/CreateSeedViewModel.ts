import type nt from '@wallet/nekoton-wasm'
import { makeAutoObservable, runInAction } from 'mobx'
import { ChangeEvent } from 'react'
import { inject, injectable } from 'tsyringe'

import { parseError } from '@app/popup/utils'
import {
    AccountabilityStep,
    AccountabilityStore,
    createEnumField,
    NekotonToken,
    RpcStore,
} from '@app/popup/modules/shared'
import type { Nekoton } from '@app/models'
import { DEFAULT_WALLET_TYPE } from '@app/shared/contracts'

@injectable()
export class CreateSeedViewModel {

    public name: string | undefined

    public loading = false

    public error = ''

    public flow = AddSeedFlow.Create

    public step = createEnumField<typeof Step>(Step.Index)

    private _seed: nt.GeneratedMnemonic | null = null

    constructor(
        @inject(NekotonToken) private nekoton: Nekoton,
        private rpcStore: RpcStore,
        private accountability: AccountabilityStore,
    ) {
        makeAutoObservable(this, undefined, { autoBind: true })
    }

    public get seed(): nt.GeneratedMnemonic {
        if (!this._seed) {
            this._seed = this.nekoton.generateMnemonic(
                this.nekoton.makeLabsMnemonic(0),
            )
        }

        return this._seed
    }

    public get seedWords(): string[] {
        return this.seed.phrase.split(' ')
    }

    public onNameChange(e: ChangeEvent<HTMLInputElement>): void {
        this.name = e.target.value
    }

    public onFlowChange(value: AddSeedFlow): void {
        this.flow = value
    }

    public async onSubmit(password: string): Promise<void> {
        this.loading = true

        try {
            let nameToSave = this.name?.trim()
            if (nameToSave?.length === 0) {
                nameToSave = undefined
            }

            const key = await this.rpcStore.rpc.createMasterKey({
                select: false,
                seed: this.seed,
                name: nameToSave,
                password,
            })

            if (this.flow === AddSeedFlow.Import || this.flow === AddSeedFlow.ImportLegacy) {
                const accounts = await this.accountability.addExistingWallets(key.publicKey)

                if (!accounts.length) {
                    await this.rpcStore.rpc.createAccount({
                        name: key.name,
                        contractType: DEFAULT_WALLET_TYPE,
                        publicKey: key.publicKey,
                        workchain: 0,
                    })
                }

                this.rpcStore.rpc.ensureAccountSelected()
            }


            this.accountability.onManageMasterKey(key)
            this.accountability.onManageDerivedKey(key)
        }
        catch (e: any) {
            runInAction(() => {
                this.error = parseError(e)
            })
        }
        finally {
            runInAction(() => {
                this.loading = false
            })
        }
    }

    public onNext(): void {
        switch (this.step.value) {
            case Step.ShowPhrase:
                this.step.setValue(Step.CheckPhrase)
                break

            case Step.CheckPhrase:
                this.step.setValue(Step.PasswordRequest)
                break

            default:
                if (this.flow === AddSeedFlow.Create) {
                    this.step.setValue(Step.ShowPhrase)
                }
                else if (this.flow === AddSeedFlow.Import || this.flow === AddSeedFlow.ImportLegacy) {
                    this.step.setValue(Step.ImportPhrase)
                }
                else if (this.flow === AddSeedFlow.ConnectLedger) {
                    this.step.setValue(Step.ConnectLedger)
                }
        }
    }

    public onNextWhenImport(words: string[]): void {
        const phrase = words.join(' ')
        const mnemonicType: nt.MnemonicType = this.flow === AddSeedFlow.ImportLegacy
            ? { type: 'legacy' }
            : { type: 'labs', accountId: 0 }

        try {
            this.nekoton.validateMnemonic(phrase, mnemonicType)
            this._seed = { phrase, mnemonicType }
            this.step.setValue(Step.PasswordRequest)
        }
        catch (e: any) {
            this.error = parseError(e)
        }
    }

    public onBack(): void {
        this.error = ''

        switch (this.step.value) {
            case Step.ShowPhrase:
            case Step.ImportPhrase:
                this.step.setValue(Step.Index)
                break

            case Step.CheckPhrase:
                this.step.setValue(Step.ShowPhrase)
                break

            case Step.PasswordRequest:
                if (this.flow === AddSeedFlow.Create) {
                    this.step.setValue(Step.ShowPhrase)
                }
                else if (this.flow === AddSeedFlow.Import || this.flow === AddSeedFlow.ImportLegacy) {
                    this.step.setValue(Step.ImportPhrase)
                }
                else if (this.flow === AddSeedFlow.ConnectLedger) {
                    this.step.setValue(Step.ConnectLedger)
                }
                break

            default:
                this.accountability.setStep(AccountabilityStep.MANAGE_SEEDS)
                break
        }
    }

    public getBip39Hints(word: string): string[] {
        return this.nekoton.getBip39Hints(word)
    }

}

export enum AddSeedFlow {
    Create,
    Import,
    ImportLegacy,
    ConnectLedger,
}

export enum Step {
    Index,
    ShowPhrase,
    CheckPhrase,
    PasswordRequest,
    ImportPhrase,
    ConnectLedger,
}

export interface OptionType {
    key: AddSeedFlow;
    value: AddSeedFlow;
    label: string;
}
