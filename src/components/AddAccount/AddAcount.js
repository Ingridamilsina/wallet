import { useState } from 'react'
import { Link } from 'react-router-dom'
import LoginOrSignup from '../LoginOrSignupForm/LoginOrSignupForm'
import TrezorConnect from 'trezor-connect'
import { TrezorSubprovider } from '@0x/subproviders/lib/src/subproviders/trezor' // https://github.com/0xProject/0x-monorepo/issues/1400
import { LedgerSubprovider } from '@0x/subproviders/lib/src/subproviders/ledger' // https://github.com/0xProject/0x-monorepo/issues/1400
import { ledgerEthereumBrowserClientFactoryAsync } from '@0x/subproviders/lib/src' // https://github.com/0xProject/0x-monorepo/issues/1400

import { fetch, fetchPost } from '../../lib/fetch'

TrezorConnect.manifest({
  email: 'contactus@ambire.com',
  appUrl: 'https://www.ambire.com'
})


// @TODO REFACTOR: use import for these
const { generateAddress2 } = require('ethereumjs-util')
const { getProxyDeployBytecode } = require('adex-protocol-eth/js/IdentityProxyDeploy')
const { Wallet } = require('ethers')
const { hexZeroPad, AbiCoder, keccak256, id } = require('ethers').utils

// NOTE: This is a compromise, but we can afford it cause QuickAccs require a secondary key
// Consider more
const SCRYPT_ITERATIONS = 131072/8

export default function AddAccount ({ relayerURL, onAddAccount }) {
    const [signersToChoose, setChooseSigners] = useState(null)

    const addMultipleAccounts = accs => {
        if (accs[0]) accs[0].selected = true
        accs.forEach(onAddAccount)
    }

    const onAccRequest = async (req) => {
        // @TODO proper salt
        const salt = hexZeroPad('0x01', 32)
        const firstKeyWallet = Wallet.createRandom()

        // @TODO fix this hack, use another source of randomness
        // 6 words is 2048**6
        const secondKeySecret = Wallet.createRandom({
            extraEntropy: id(req.email+':'+Date.now())
        }).mnemonic.phrase.split(' ').slice(0, 6).join(' ') + ' ' + req.email

        const [
            secondKeyAddress,
            { whitelistedFactories, whitelistedBaseIdentities }
        ] = await Promise.all([
            fetchPost(`${relayerURL}/second-key`, { secondKeySecret }).then(r => r.address),
            fetch(`${relayerURL}/relayer/cfg`).then(r => r.json())
        ])

        // @TODO: timelock value for the quickAccount
        const quickAccount = [600, firstKeyWallet.address, secondKeyAddress]
        const abiCoder = new AbiCoder()
        const accHash = keccak256(abiCoder.encode(['tuple(uint, address, address)'], [quickAccount]))
        // @TODO not hardcoded
        const quickAccManager = '0x697d866d20a8E8886a0D0511e82846AC108Bc5B6'
        const privileges = [[quickAccManager, accHash]]
        const identityFactoryAddr = whitelistedFactories[whitelistedFactories.length - 1]
        const baseIdentityAddr = whitelistedBaseIdentities[whitelistedBaseIdentities.length - 1]
        const bytecode = getProxyDeployBytecode(baseIdentityAddr, privileges, { privSlot: 0 })
        const identityAddr = '0x' + generateAddress2(identityFactoryAddr, salt, bytecode).toString('hex')

        const primaryKeyBackup = JSON.stringify(
            await firstKeyWallet.encrypt(req.passphrase, { scrypt: { N: SCRYPT_ITERATIONS } })
        )

        // @TODO catch errors here - wrong status codes, etc.
        const createResp = await fetchPost(`${relayerURL}/identity/${identityAddr}`, {
            email: req.email,
            primaryKeyBackup: req.backupOptout ? null : primaryKeyBackup,
            secondKeySecret,
            salt, identityFactoryAddr, baseIdentityAddr,
            privileges,
            selecterd: true
        })

        // @TODO check for success
        // @TODO remove this
        console.log('identityAddr:', identityAddr, quickAccount, createResp)

        return {
            _id: identityAddr,
            email: req.email,
            primaryKeyBackup,
            salt, identityFactoryAddr, baseIdentityAddr,
            // @TODO signer
        }
    }

    async function connectWeb3AndGetAccounts () {
        // @TODO: pending state; should bein the LoginORSignup (AddAccount) component
        if (typeof window.ethereum === 'undefined') {
            // @TODO catch this
            throw new Error('MetaMask not available')
        }
        const ethereum = window.ethereum
        const web3Accs = await ethereum.request({ method: 'eth_requestAccounts' })
        return getOwnedByEOAs(web3Accs)
    }

    async function getOwnedByEOAs(eoas) {
        const allOwnedIdentities = await Promise.all(eoas.map(
            async acc => {
                const resp = await fetch(`${relayerURL}/identity/any/by-owner/${acc}?includeFormerlyOwned=true`)
                return await resp.json()
            }
        ))

        let allUniqueOwned = {}
        // preserve the last truthy priv value
        allOwnedIdentities.forEach(x => 
            Object.entries(x).forEach(
                ([id, priv]) => allUniqueOwned[id] = priv ||  allUniqueOwned[id]
            )
        )

        return await Promise.all(Object.keys(allUniqueOwned).map(getAccountByAddr))
    }

    async function getAccountByAddr (addr) {
        // @TODO: fundamentally, do we even need these values?
        const { salt, identityFactoryAddr, baseIdentityAddr } = await fetch(`${relayerURL}/identity/${addr}`)
            .then(r => r.json())
        return {
            _id: addr,
            salt, identityFactoryAddr, baseIdentityAddr,
            // @TODO signer for the ones that we CURRENTLY control
        }
    }

    async function connectTrezorAndGetAccounts () {
        /*
        const engine = new Web3ProviderEngine({ pollingInterval: this.pollingInterval })
        engine.addProvider(new TrezorSubprovider({ trezorConnectClientApi: TrezorConnect, ...this.config }))
        engine.addProvider(new CacheSubprovider())
        engine.addProvider(new RPCSubprovider(this.url, this.requestTimeoutMs))
        */
        const provider = new TrezorSubprovider({ trezorConnectClientApi: TrezorConnect })
        setChooseSigners(await provider.getAccountsAsync(50))
    }

    async function connectLedgerAndGetAccounts () {
        const provider = new LedgerSubprovider({
            networkId: 0, // @TODO: is this needed?
            ledgerEthereumClientFactoryAsync: ledgerEthereumBrowserClientFactoryAsync,
            //baseDerivationPath: this.baseDerivationPath
        })
        setChooseSigners(await provider.getAccountsAsync(50))
    }

    if (signersToChoose) {
        return (
            <ul>
                {signersToChoose.map(addr => (<li key={addr} onClick={() => {
                    setChooseSigners(null)
                    }}>{addr}</li>))}
            </ul>
        )
    }

    return (<div className="loginSignupWrapper">
        <div id="logo"/>
        <section id="addAccount">
          <div id="loginEmail">
            <h3>Create a new account</h3>
            <LoginOrSignup onAccRequest={req => onAccRequest(req).then(onAddAccount)} action="SIGNUP"></LoginOrSignup>
          </div>
    
          <div id="loginSeparator">
            <div className="verticalLine"></div>
            <span>or</span>
            <div className="verticalLine"></div>
          </div>
    
          <div id="loginOthers">
            <h3>Add an existing account</h3>
            <Link to="/email-login">
              <button><div className="icon" style={{ backgroundImage: 'url(./resources/envelope.png)' }}/>Email</button>
            </Link>
            <button onClick={() => connectTrezorAndGetAccounts()}><div className="icon" style={{ backgroundImage: 'url(./resources/trezor.png)' }}/>Trezor</button>
            <button onClick={() => connectLedgerAndGetAccounts()}><div className="icon" style={{ backgroundImage: 'url(./resources/ledger.png)' }}/>Ledger</button>
            <button onClick={() => connectWeb3AndGetAccounts().then(addMultipleAccounts)}><div className="icon" style={{ backgroundImage: 'url(./resources/metamask.png)' }}/>Metamask / Browser</button>
          </div>
        </section>
      </div>
    )
}