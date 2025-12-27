const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const PaymentRouter = require('./payment-router');

class PaymentFlowController {
    constructor(config) {
        this.app = express();
        this.router = new PaymentRouter(config);
        this.setupMiddleware();
        this.setupRoutes();
        this.transactionHistory = [];
        this.failureMetrics = {
            totalFailures: 0,
            providerFailures: {},
            lastFailureTime: null
        };
    }

    setupMiddleware() {
        this.app.use(helmet());
        this.app.use(cors());
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
    }

    setupRoutes() {
        this.app.post('/api/payment/execute', async (req, res) => {
            const startTime = Date.now();
            try {
                const { fromAddress, toAddress, amount, tokenContract, priority = 'medium' } = req.body;
                
                if (!fromAddress || !toAddress || !amount) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing required parameters' 
                    });
                }

                const result = await this.router.executePayment(fromAddress, toAddress, amount, tokenContract);
                
                this.recordTransaction({
                    ...result,
                    fromAddress,
                    toAddress,
                    amount: amount.toString(),
                    tokenContract,
                    processingTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                });

                res.json(result);

            } catch (error) {
                this.recordFailure(error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    code: error.code || 'UNKNOWN_ERROR'
                });
            }
        });

        this.app.post('/api/payment/batch', async (req, res) => {
            try {
                const { payments } = req.body;
                
                if (!Array.isArray(payments)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Payments must be an array'
                    });
                }

                const results = await this.router.batchPayments(payments);
                
                results.forEach((result, index) => {
                    this.recordTransaction({
                        ...result,
                        ...payments[index],
                        timestamp: new Date().toISOString()
                    });
                });

                res.json({
                    success: true,
                    results: results,
                    processed: results.length,
                    successful: results.filter(r => r.success).length,
                    failed: results.filter(r => !r.success).length
                });

            } catch (error) {
                this.recordFailure(error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.get('/api/payment/status', (req, res) => {
            res.json({
                success: true,
                status: 'operational',
                metrics: this.getSystemMetrics(),
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            });
        });

        this.app.get('/api/payment/history', (req, res) => {
            const { limit = 50, offset = 0, status } = req.query;
            let filteredHistory = this.transactionHistory;
            
            if (status) {
                filteredHistory = this.transactionHistory.filter(tx => 
                    tx.success === (status === 'success')
                );
            }

            const results = filteredHistory
                .slice(parseInt(offset), parseInt(offset) + parseInt(limit));

            res.json({
                success: true,
                transactions: results,
                total: filteredHistory.length,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        });

        this.app.get('/api/payment/metrics', (req, res) => {
            res.json({
                success: true,
                metrics: this.getDetailedMetrics()
            });
        });
    }

    recordTransaction(transaction) {
        this.transactionHistory.unshift(transaction);
        if (this.transactionHistory.length > 1000) {
            this.transactionHistory = this.transactionHistory.slice(0, 1000);
        }
    }

    recordFailure(error) {
        this.failureMetrics.totalFailures++;
        this.failureMetrics.lastFailureTime = new Date().toISOString();
        
        const provider = error.provider || 'unknown';
        this.failureMetrics.providerFailures[provider] = 
            (this.failureMetrics.providerFailures[provider] || 0) + 1;
    }

    getSystemMetrics() {
        const recent = this.transactionHistory.slice(0, 100);
        const successful = recent.filter(tx => tx.success).length;
        const avgProcessingTime = recent.reduce((sum, tx) => 
            sum + (tx.processingTime || 0), 0) / recent.length;

        return {
            totalTransactions: this.transactionHistory.length,
            recentSuccessRate: recent.length > 0 ? (successful / recent.length) * 100 : 0,
            averageProcessingTime: Math.round(avgProcessingTime || 0),
            totalFailures: this.failureMetrics.totalFailures,
            lastFailure: this.failureMetrics.lastFailureTime
        };
    }

    getDetailedMetrics() {
        const last24Hours = this.transactionHistory.filter(tx => 
            new Date(tx.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
        );

        return {
            system: this.getSystemMetrics(),
            last24Hours: {
                total: last24Hours.length,
                successful: last24Hours.filter(tx => tx.success).length,
                failed: last24Hours.filter(tx => !tx.success).length,
                totalVolume: last24Hours.reduce((sum, tx) => 
                    sum + parseFloat(tx.amount || 0), 0)
            },
            providerFailures: this.failureMetrics.providerFailures
        };
    }

    start(port = 3000) {
        this.app.listen(port, () => {
            console.log(`🚀 Payment Router API running on port ${port}`);
            console.log(`📊 Metrics available at http://localhost:${port}/api/payment/metrics`);
        });
    }
}

module.exports = PaymentFlowController;
