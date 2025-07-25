import Decimal from 'decimal.js'
import { EventEmitter } from 'events'
import safeStringify from 'fast-safe-stringify'
import memoize from 'lodash.memoize'
import type nt from '@wallet/nekoton-wasm'
import { Duplex } from 'readable-stream'

import {
    BaseNftJson,
    ConfirmTransaction,
    NekotonRpcError,
    RpcErrorCode,
    SubmitTransaction,
} from '@app/models'

import type {
    JsonRpcEngine,
    JsonRpcEngineEndCallback,
    JsonRpcEngineNextCallback,
    JsonRpcMiddleware,
    JsonRpcNotification,
    JsonRpcRequest,
    PendingJsonRpcResponse,
} from './jrpc'

const MAX = 4294967295

let idCounter = Math.floor(Math.random() * MAX)

export const getUniqueId = (): number => {
    idCounter = (idCounter + 1) % MAX
    return idCounter
}

export type Maybe<T> = Partial<T> | null | undefined;

export type ConsoleLike = Pick<Console, 'log' | 'warn' | 'error' | 'debug' | 'info' | 'trace'>;

type Handler = (...args: any[]) => void;

interface EventMap {
    [k: string]: Handler | Handler[] | undefined;
}

export type DomainMetadata = {
    name: string
    icon: string | undefined
};

function safeApply<T, A extends any[]>(
    handler: (this: T, ...args: A) => void,
    context: T,
    args: A,
): void {
    try {
        Reflect.apply(handler, context, args)
    }
    catch (err) {
        // Throw error after timeout so as not to interrupt the stack
        setTimeout(() => {
            throw err
        })
    }
}

function arrayClone<T>(arr: T[]): T[] {
    const n = arr.length
    const copy = new Array(n)
    for (let i = 0; i < n; i += 1) {
        copy[i] = arr[i]
    }
    return copy
}

type ObjectValueOfMap<M extends {}, K extends keyof M> = M[K] extends {} ? M[K] : never;
export const getOrInsertDefault = <M extends {}, K extends keyof M>(
    map: M,
    key: K,
): ObjectValueOfMap<M, K> => {
    let result = map[key] as M[K] | undefined
    if (result == null) {
        result = {} as M[K]
        map[key] = result
    }
    return result as ObjectValueOfMap<M, K>
}

export const currentUtime = (clockOffset: number) => Math.floor((new Date().getTime() + clockOffset) / 1000)

export class SafeEventEmitter extends EventEmitter {

    emit(type: string, ...args: any[]): boolean {
        let doError = type === 'error'

        const events: EventMap = (this as any)._events
        if (events !== undefined) {
            doError = doError && events.error === undefined
        }
        else if (!doError) {
            return false
        }

        if (doError) {
            let er
            if (args.length > 0) {
                [er] = args
            }
            if (er instanceof Error) {
                throw er
            }

            const err = new Error(`Unhandled error.${er ? ` (${er.message})` : ''}`);
            (err as any).context = er
            throw err
        }

        const handler = events[type]

        if (handler === undefined) {
            return false
        }

        if (typeof handler === 'function') {
            safeApply(handler, this, args)
        }
        else {
            const len = handler.length
            const listeners = arrayClone(handler)
            for (let i = 0; i < len; i += 1) {
                safeApply(listeners[i], this, args)
            }
        }

        return true
    }

}

const callbackNoop = (error?: Error) => {
    if (error) {
        throw error
    }
}

type NodeifyAsyncResult<F> = F extends (...args: infer T) => Promise<infer U>
    ? (...args: [...T, (error: Error | null, result?: U) => void]) => void
    : never;

export const nodeifyAsync = <C extends {}, M extends keyof C>(
    context: C,
    method: M,
): NodeifyAsyncResult<C[M]> => {
    const fn = context[method] as unknown as (...args: any[]) => Promise<any>
    return function (...args: any[]) {
        const lastArg = args[args.length - 1]
        const lastArgIsCallback = typeof lastArg === 'function'

        let callback: Function
        if (lastArgIsCallback) {
            callback = lastArg
            args.pop()
        }
        else {
            callback = callbackNoop
        }

        fn.apply(context, args)
            .then(data => queueMicrotask(() => callback(null, data)))
            .catch(error => queueMicrotask(() => callback(error)))
    } as unknown as NodeifyAsyncResult<C[M]>
}

type NodeifyResult<F> = F extends (...args: [...infer T, (error: Error | null, result?: infer U) => void]) => void
    ? (...args: [...T, (error: Error | null, result?: U) => void]) => void
    : F extends (...args: infer T) => void
        ? (...args: [...T, (error: Error | null, result: undefined) => void]) => void
        : never;

export const nodeify = <C extends {}, M extends keyof C>(
    context: C,
    method: M,
): NodeifyResult<C[M]> => {
    const fn = context[method] as unknown as Function
    return function (...args: any[]) {
        const lastArg = args[args.length - 1]
        const lastArgIsCallback = typeof lastArg === 'function'

        let callback: Function
        if (lastArgIsCallback) {
            callback = lastArg
            args.pop()
        }
        else {
            callback = callbackNoop
        }

        let result
        try {
            result = Promise.resolve(fn.apply(context, args))
        }
        catch (e: any) {
            result = Promise.reject(e)
        }

        result
            .then(data => queueMicrotask(() => callback(null, data)))
            .catch(error => queueMicrotask(() => callback(error)))
    } as unknown as NodeifyResult<C[M]>
}

export const logStreamDisconnectWarning = (
    log: ConsoleLike,
    remoteLabel: string,
    error: Error | undefined,
    emitter: EventEmitter,
) => {
    let warningMsg = `Nekoton: Lost connection to "${remoteLabel}".`
    if (error?.stack) {
        warningMsg += `\n${error.stack}`
    }
    log.warn(warningMsg)
    if (emitter && emitter.listenerCount('error') > 0) {
        emitter.emit('error', warningMsg)
    }
}

// eslint-disable-next-line max-len
export const getRpcPromiseCallback = (resolve: (value?: any) => void, reject: (error?: Error) => void, unwrapResult = true) => (error: Error, response: PendingJsonRpcResponse<unknown>) => {
    if (error || response.error) {
        reject(error || response.error)
    }
    else if (!unwrapResult || Array.isArray(response)) {
        resolve(response)
    }
    else {
        resolve(response.result)
    }
}

interface EngineStreamOptions {
    engine: JsonRpcEngine;
}

export const createEngineStream = (options: EngineStreamOptions): Duplex => {
    if (!options || !options.engine) {
        throw new Error('Missing engine parameter!')
    }

    const { engine } = options
    const stream = new Duplex({
        objectMode: true,
        read: () => false,
        write: (
            request: JsonRpcRequest<unknown>,
            _encoding: unknown,
            cb: (error?: Error | null) => void,
        ) => {
            engine.handle(request, (_err, res) => {
                stream.push(res)
            })
            cb()
        },
    })

    if (engine.on) {
        engine.on('notification', message => {
            stream.push(message)
        })
    }

    return stream
}

interface IdMapValue {
    req: JsonRpcRequest<unknown>;
    res: PendingJsonRpcResponse<unknown>;
    next: JsonRpcEngineNextCallback;
    end: JsonRpcEngineEndCallback;
}

interface IdMap {
    [requestId: string]: IdMapValue;
}

export const createStreamMiddleware = () => {
    const idMap: IdMap = {}
    const stream = new Duplex({
        objectMode: true,
        read: readNoop,
        write: processMessage,
    })

    const events = new SafeEventEmitter()

    const middleware: JsonRpcMiddleware<unknown, unknown> = (req, res, next, end) => {
        stream.push(req)
        idMap[req.id as unknown as string] = { req, res, next, end }
    }

    return { events, middleware, stream }

    function readNoop() {
        return false
    }

    function processMessage(
        res: PendingJsonRpcResponse<unknown>,
        _encoding: unknown,
        cb: (error?: Error | null) => void,
    ) {
        let err: any
        try {
            const isNotification = !res.id
            if (isNotification) {
                processNotification(res as unknown as JsonRpcNotification<unknown>)
            }
            else {
                processResponse(res)
            }
        }
        catch (_err: any) {
            err = _err
        }
        cb(err)
    }

    function processResponse(res: PendingJsonRpcResponse<unknown>) {
        const context = idMap[res.id as unknown as string]
        if (!context) {
            throw new Error(`StreamMiddleware: Unknown response id "${res.id}"`)
        }

        delete idMap[res.id as unknown as string]
        Object.assign(context.res, res)
        setTimeout(context.end)
    }

    function processNotification(res: JsonRpcNotification<unknown>) {
        events.emit('notification', res)
    }
}

export const createErrorMiddleware = (log: ConsoleLike): JsonRpcMiddleware<unknown, unknown> => (req, res, next) => {
    if (!req.method) {
        res.error = new NekotonRpcError(
            RpcErrorCode.INVALID_REQUEST,
            'The request \'method\' must be a non-empty string.',
        )
    }

    next(done => {
        const { error } = res
        if (!error) {
            return done()
        }
        log.debug(`Nekoton: RPC Error: ${error.message}`, error)
        return done()
    })
}

export const createIdRemapMiddleware = (): JsonRpcMiddleware<unknown, unknown> => (req, res, next) => {
    const originalId = req.id
    const newId = getUniqueId()
    req.id = newId
    res.id = newId
    next(done => {
        req.id = originalId
        res.id = originalId
        done()
    })
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
    stack?: string;
}

const FALLBACK_ERROR: JsonRpcError = {
    code: RpcErrorCode.INTERNAL,
    message: 'Unspecified error message',
}

export const serializeError = (
    error: unknown,
    { fallbackError = FALLBACK_ERROR, shouldIncludeStack = false } = {},
): JsonRpcError => {
    if (
        !fallbackError
        || !Number.isInteger(fallbackError.code)
        || (typeof fallbackError.message as any) !== 'string'
    ) {
        throw new Error('Must provide fallback error with integer number code and string message')
    }

    if (error instanceof NekotonRpcError) {
        return error.serialize()
    }

    const serialized: Partial<JsonRpcError> = {}

    if (
        error
        && typeof error === 'object'
        && !Array.isArray(error)
        && hasKey(error as Record<string, unknown>, 'code')
    ) {
        const typedError = error as Partial<JsonRpcError>
        serialized.code = typedError.code

        if (typedError.message && (typeof typedError.message as any) === 'string') {
            serialized.message = typedError.message

            if (hasKey(typedError, 'data')) {
                serialized.data = typedError.data
            }
        }
        else {
            serialized.message = 'TODO: get message from code'

            serialized.data = { originalError: assignOriginalError(error) }
        }
    }
    else {
        serialized.code = fallbackError.code

        const message = (error as any)?.message

        serialized.message = message && typeof message === 'string' ? message : fallbackError.message
        serialized.data = { originalError: assignOriginalError(error) }
    }

    const stack = (error as any)?.stack

    if (shouldIncludeStack && error && stack && (typeof stack as any) === 'stack') {
        serialized.stack = stack
    }

    return serialized as JsonRpcError
}

export const jsonify = <T extends {}>(request: T): string => safeStringify(request, stringifyReplacer, 2)

function stringifyReplacer(_: unknown, value: unknown): unknown {
    if (value === '[Circular]') {
        return undefined
    }
    return value
}

function assignOriginalError(error: unknown): unknown {
    if (error && typeof error === 'object' && !Array.isArray(error)) {
        return { ...error }
    }
    return error
}

function hasKey(obj: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key)
}

export type UniqueArray<T> = T extends readonly [infer X, ...infer Rest]
    ? InArray<Rest, X> extends true
        ? ['Encountered value with duplicates:', X]
        : readonly [X, ...UniqueArray<Rest>]
    : T;

// eslint-disable-next-line unused-imports/no-unused-vars-ts
export type InArray<T, X> = T extends readonly [X, ...infer _Rest]
    ? true
    : T extends readonly [X]
        ? true
        : T extends readonly [infer _, ...infer Rest] // eslint-disable-line unused-imports/no-unused-vars-ts
            ? InArray<Rest, X>
            : false;

export const shuffleArray = <T>(array: T[]) => {
    let currentIndex = array.length,
        temporaryValue: T,
        randomIndex: number

    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex)
        currentIndex -= 1

        temporaryValue = array[currentIndex]
        array[currentIndex] = array[randomIndex]
        array[randomIndex] = temporaryValue
    }

    return array
}

export type AggregatedMultisigTransactionInfo = {
    finalTransactionHash?: string
    confirmations: string[]
    createdAt: number
};

export type AggregatedMultisigTransactions = {
    [transactionId: string]: AggregatedMultisigTransactionInfo
};

export const extractMultisigTransactionTime = (transactionId: string) => parseInt(transactionId.slice(0, -8), 16)

export const extractTransactionValue = (transaction: nt.Transaction): Decimal => {
    const transactionWithInfo = transaction as nt.TonWalletTransaction
    if (
        transactionWithInfo.info?.type === 'wallet_interaction'
        && transactionWithInfo.info.data.method.type === 'multisig'
        && transactionWithInfo.info.data.method.data.type === 'submit'
        && transactionWithInfo.info.data.method.data.data.transactionId !== '0'
    ) {
        return new Decimal(transactionWithInfo.info.data.method.data.data.value).mul(-1)
    }

    const outgoing = transaction.outMessages.reduce(
        (total, msg) => total.add(msg.value),
        new Decimal(0),
    )
    return new Decimal(transaction.inMessage.value).sub(outgoing)
}

export type TransactionDirection = 'from' | 'to' | 'service';

export function isConfirmTransaction(
    transaction: nt.TonWalletTransaction | nt.TokenWalletTransaction,
): transaction is ConfirmTransaction {
    return (
        transaction.info?.type === 'wallet_interaction'
        && transaction.info.data.method.type === 'multisig'
        && transaction.info.data.method.data.type === 'confirm'
    )
}

export function isSubmitTransaction(
    transaction: nt.TonWalletTransaction | nt.TokenWalletTransaction,
): transaction is SubmitTransaction {
    return (
        transaction.info?.type === 'wallet_interaction'
        && transaction.info.data.method.type === 'multisig'
        && transaction.info.data.method.data.type === 'submit'
        && transaction.info.data.method.data.data.transactionId !== '0'
        && transaction.outMessages.every(msg => !msg.dst)
    )
}

export const extractTransactionAddress = (transaction: nt.Transaction): {
    direction: TransactionDirection;
    address: string;
} => {
    const transactionWithInfo = transaction as nt.TonWalletTransaction
    if (
        transactionWithInfo.info?.type === 'wallet_interaction'
        && transactionWithInfo.info.data.method.type === 'multisig'
    ) {
        switch (transactionWithInfo.info.data.method.data.type) {
            case 'submit':
                return {
                    direction: 'to',
                    address: transactionWithInfo.info.data.method.data.data.dest,
                }
            case 'send':
                return {
                    direction: 'to',
                    address: transactionWithInfo.info.data.method.data.data.dest,
                }
            case 'confirm':
                return {
                    direction: 'service',
                    address: '',
                }

            default: throw new Error('Unexpected type')
        }
    }

    for (const item of transaction.outMessages) {
        if (item.dst != null) {
            return { direction: 'to', address: item.dst }
        }
    }

    if (transaction.inMessage.src != null) {
        return { direction: 'from', address: transaction.inMessage.src }
    }
    return { direction: 'service', address: transaction.inMessage.dst || '' }
}

const OUTGOING_TOKEN_TRANSACTION_TYPES: Exclude<nt.TokenWalletTransaction['info'], undefined>['type'][] = ['outgoing_transfer', 'swap_back']

export const extractTokenTransactionValue = ({ info }: nt.TokenWalletTransaction) => {
    if (info == null) {
        return undefined
    }

    const tokens = new Decimal(info.data.tokens)
    if (OUTGOING_TOKEN_TRANSACTION_TYPES.includes(info.type)) {
        return tokens.negated()
    }
    return tokens
}

export type TokenTransactionAddress =
    | undefined
    | nt.TransferRecipient
    | { type: 'proxy'; address: string };

export const extractTokenTransactionAddress = ({
    info,
}: nt.TokenWalletTransaction): TokenTransactionAddress => {
    if (info == null) {
        return undefined
    }

    if (info.type === 'incoming_transfer') {
        return { type: 'owner_wallet', address: info.data.senderAddress }
    }
    if (info.type === 'outgoing_transfer') {
        return info.data.to
    }
    if (info.type === 'swap_back') {
        return { type: 'proxy', address: info.data.callbackAddress }
    }
    return undefined
}

export const convertPublicKey = (publicKey: string | undefined) => (publicKey ? `${publicKey?.slice(0, 4)}...${publicKey?.slice(-4)}` : '')

export const convertAddress = (address: string | undefined) => (address ? `${address?.slice(0, 6)}...${address?.slice(-4)}` : '')

export const trimTokenName = (token: string | undefined) => (token ? `${token?.slice(0, 4)}...${token?.slice(-4)}` : '')

// eslint-disable-next-line no-nested-ternary
export const convertTokenName = (token: string | undefined) => (token ? (token.length >= 10 ? trimTokenName(token) : token) : '')

export const multiplier = memoize((decimals: number) => new Decimal(10).pow(decimals))

export const amountPattern = memoize(
    (decimals: number) => new RegExp(`^(?:0|[1-9][0-9]*)(?:.[0-9]{0,${decimals}})?$`),
)

export const convertCurrency = (amount: string | undefined, decimals: number) => new Decimal(amount || '0').div(multiplier(decimals)).toFixed()

export const convertEvers = (amount?: string) => convertCurrency(amount, 9)

export const parseCurrency = (
    amount: string,
    decimals: number,
) => new Decimal(amount).mul(multiplier(decimals)).ceil().toFixed(0)

export const tryParseCurrency = (
    amount: string,
    decimals: number,
) => {
    try {
        return parseCurrency(amount, decimals)
    }
    catch {
        return '0'
    }
}

export const parseEvers = (amount: string) => parseCurrency(amount, 9)

// https://uneven-pot-701.notion.site/08b1b7a7732e40948c9d5bd386d97761
export const formatCurrency = (amount: Decimal.Value): string => {
    const d = new Decimal(amount)

    if (d.lessThan(1)) {
        return d.toDecimalPlaces(8, Decimal.ROUND_FLOOR).toFixed()
    }
    if (d.lessThan(1000)) {
        return d.toDecimalPlaces(4, Decimal.ROUND_FLOOR).toFixed()
    }

    return d.toFixed(0, Decimal.ROUND_FLOOR)
}

export const splitAddress = (address: string | undefined) => {
    const half = address != null ? Math.ceil(address.length / 2) : 0
    return half > 0 ? `${address!.slice(0, half)}\n${address!.slice(-half)}` : ''
}

export const getAddressHash = (address: string) => address.slice(2)

export const delay = (ms: number) => new Promise(resolve => {
    setTimeout(resolve, ms)
})

export const timer = (ms: number): AsyncTimer => {
    let resolve: () => void,
        timeoutId: number

    const promise = new Promise<void>(_resolve => {
        resolve = _resolve
        timeoutId = self.setTimeout(_resolve, ms)
    })

    return {
        promise,
        cancel() {
            self.clearTimeout(timeoutId)
            resolve()
        },
    }
}

export const interval = (callback: () => void, ms: number) => {
    const intervalId = setInterval(callback, ms)
    return () => clearInterval(intervalId)
}

export const transactionExplorerLink = (baseUrl: string | undefined, hash: string) => {
    if (!baseUrl) {
        return `https://everscan.io/transactions/${hash}`
    }
    if (baseUrl.includes('ever.live') || baseUrl.includes('localhost')) {
        return `${baseUrl}/transactions/transactionDetails?id=${hash}`
    }
    return `${baseUrl}/transactions/${hash}`
}

export const accountExplorerLink = (baseUrl: string | undefined, address: string) => {
    if (!baseUrl) {
        return `https://everscan.io/accounts/${address}`
    }
    if (baseUrl.includes('ever.live') || baseUrl.includes('localhost')) {
        return `${baseUrl}/accounts/accountDetails?id=${address}`
    }
    return `${baseUrl}/accounts/${address}`
}

export interface SendMessageCallback {
    resolve: (transaction?: nt.Transaction) => void;
    reject: (error?: Error) => void;
}

export type SelectedAsset =
    | nt.EnumItem<'ever_wallet', { address: string }>
    | nt.EnumItem<'token_wallet', { owner: string; rootTokenContract: string }>;

export type AssetType = SelectedAsset['type'];

export interface TokenWalletState {
    balance: string;
}

export interface AsyncTimer {
    promise: Promise<void>;

    cancel(): void;
}

const IMAGE_REGEXP = /image\//i
export const getNftPreview = (json: BaseNftJson): string | undefined => (json.preview?.mimetype.match(IMAGE_REGEXP)
    ? json.preview?.source
    : undefined) ?? getNftImage(json)

export const getNftImage = (json: BaseNftJson): string | undefined => json.files?.find(
    (file) => !!file.mimetype.match(IMAGE_REGEXP),
)?.source

export const throwError = (err: Error): never => {
    throw err
}
