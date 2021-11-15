import './Earn.scss'
import AAVECard from './Cards/AAVECard'

const Earn = ({ portfolio, selectedNetwork }) => {
    const tokenItems = portfolio.tokens.map(({ img, symbol, address, balance }) => ({
        icon: img,
        label: symbol,
        value: address,
        balance: balance.toFixed(2)
    }))

    return (
        <div id="earn">
            <AAVECard network={{...selectedNetwork}} tokens={tokenItems}/>
        </div>
    )
}

export default Earn