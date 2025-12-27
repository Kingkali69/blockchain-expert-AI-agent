require('dotenv').config();
const PaymentFlowController = require('./payment-flow-controller');

const config = {
    rpcEndpoints: [
        process.env.PRIMARY_RPC || "https://eth-mainnet.alchemyapi.io/v2/your-key",
        process.env.BACKUP_RPC_1 || "https://mainnet.infura.io/v3/your-key",
        process.env.BACKUP_RPC_2 || "https://eth-mainnet.gateway.pokt.network/v1/your-key"
    ],
    privateKey: process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001"
};

const server = new PaymentFlowController(config);
const port = process.env.PORT || 3000;

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

server.start(port);
