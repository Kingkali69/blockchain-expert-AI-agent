const { ethers } = require('ethers');
const Web3 = require('web3');

class PaymentRouter {
    constructor(config) {
        this.providers = config.rpcEndpoints.map(url => new ethers.providers.JsonRpcProvider(url));
        this.web3 = new Web3(config.rpcEndpoints[0]);
        this.currentProvider = 0;
        this.wallet = new ethers.Wallet(config.privateKey);
        this.gasMultiplier = 1.2;
        this.maxRetries = 3;
    }

    async rotateProvider() {
        this.currentProvider = (this.currentProvider + 1) % this.providers.length;
        return this.providers[this.currentProvider];
    }

    async getOptimalProvider() {
        for (let i = 0; i < this.providers.length; i++) {
            try {
                const provider = this.providers[(this.currentProvider + i) % this.providers.length];
                await provider.getBlockNumber();
                this.currentProvider = (this.currentProvider + i) % this.providers.length;
                return provider;
            } catch (error) {
                continue;
            }
        }
        throw new Error('All RPC providers unavailable');
    }

    async executePayment(fromAddress, toAddress, amount, tokenContract = null) {
        const provider = await this.getOptimalProvider();
        const connectedWallet = this.wallet.connect(provider);
        
        let retries = 0;
        while (retries < this.maxRetries) {
            try {
                const nonce = await provider.getTransactionCount(fromAddress, 'pending');
                const gasPrice = await provider.getGasPrice();
                const adjustedGasPrice = gasPrice.mul(Math.floor(this.gasMultiplier * 100)).div(100);

                let tx;
                if (tokenContract) {
                    const contract = new ethers.Contract(tokenContract, ERC20_ABI, connectedWallet);
                    const gasEstimate = await contract.estimateGas.transfer(toAddress, amount);
                    tx = await contract.transfer(toAddress, amount, {
                        gasLimit: gasEstimate.mul(120).div(100),
                        gasPrice: adjustedGasPrice,
                        nonce: nonce
                    });
                } else {
                    const gasEstimate = await provider.estimateGas({
                        to: toAddress,
                        value: amount,
                        from: fromAddress
                    });
                    tx = await connectedWallet.sendTransaction({
                        to: toAddress,
                        value: amount,
                        gasLimit: gasEstimate.mul(120).div(100),
                        gasPrice: adjustedGasPrice,
                        nonce: nonce
                    });
                }

                const receipt = await tx.wait();
                return {
                    success: true,
                    hash: receipt.transactionHash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed
                };
            } catch (error) {
                retries++;
                if (error.code === 'NONCE_EXPIRED' || error.code === 'REPLACEMENT_UNDERPRICED') {
                    await this.rotateProvider();
                    continue;
                }
                if (retries >= this.maxRetries) {
                    return {
                        success: false,
                        error: error.message,
                        code: error.code
                    };
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * retries));
            }
        }
    }

    async batchPayments(payments) {
        const results = await Promise.allSettled(
            payments.map(payment => this.executePayment(
                payment.from,
                payment.to,
                payment.amount,
                payment.token
            ))
        );
        return results.map(result => result.value || { success: false, error: result.reason });
    }
}

const ERC20_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
    "event Transfer(address indexed from, address indexed to, uint256 value)"
];

module.exports = PaymentRouter;
