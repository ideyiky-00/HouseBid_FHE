import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PropertyBid {
  id: string;
  name: string;
  encryptedBid: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface BidAnalysis {
  marketValue: number;
  bidCompetitiveness: number;
  priceTrend: number;
  riskLevel: number;
  successProbability: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<PropertyBid[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showBidModal, setShowBidModal] = useState(false);
  const [submittingBid, setSubmittingBid] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newBidData, setNewBidData] = useState({ propertyName: "", bidAmount: "", description: "" });
  const [selectedProperty, setSelectedProperty] = useState<PropertyBid | null>(null);
  const [decryptedBid, setDecryptedBid] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadProperties();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadProperties = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const propertiesList: PropertyBid[] = [];
      
      for (const businessId of businessIds) {
        try {
          const propertyData = await contract.getBusinessData(businessId);
          propertiesList.push({
            id: businessId,
            name: propertyData.name,
            encryptedBid: businessId,
            publicValue1: Number(propertyData.publicValue1) || 0,
            publicValue2: Number(propertyData.publicValue2) || 0,
            description: propertyData.description,
            timestamp: Number(propertyData.timestamp),
            creator: propertyData.creator,
            isVerified: propertyData.isVerified,
            decryptedValue: Number(propertyData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading property data:', e);
        }
      }
      
      setProperties(propertiesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load properties" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const submitBid = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setSubmittingBid(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Submitting encrypted bid with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const bidAmount = parseInt(newBidData.bidAmount) || 0;
      const businessId = `property-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, bidAmount);
      
      const tx = await contract.createBusinessData(
        businessId,
        newBidData.propertyName,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newBidData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [{
        type: 'bid_submission',
        property: newBidData.propertyName,
        amount: bidAmount,
        timestamp: Date.now(),
        status: 'success'
      }, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted bid submitted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadProperties();
      setShowBidModal(false);
      setNewBidData({ propertyName: "", bidAmount: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Bid submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setSubmittingBid(false); 
    }
  };

  const decryptBid = async (propertyId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const propertyData = await contractRead.getBusinessData(propertyId);
      if (propertyData.isVerified) {
        const storedValue = Number(propertyData.decryptedValue) || 0;
        setDecryptedBid(storedValue);
        
        setUserHistory(prev => [{
          type: 'bid_decryption',
          property: propertyData.name,
          amount: storedValue,
          timestamp: Date.now(),
          status: 'verified'
        }, ...prev]);
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Bid already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(propertyId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(propertyId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      const decryptedAmount = Number(clearValue);
      setDecryptedBid(decryptedAmount);
      
      setUserHistory(prev => [{
        type: 'bid_decryption',
        property: selectedProperty?.name || '',
        amount: decryptedAmount,
        timestamp: Date.now(),
        status: 'success'
      }, ...prev]);
      
      await loadProperties();
      
      setTransactionStatus({ visible: true, status: "success", message: "Bid decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return decryptedAmount;
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Bid is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadProperties();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const analyzeBid = (property: PropertyBid, decryptedAmount: number | null): BidAnalysis => {
    const bidAmount = property.isVerified ? (property.decryptedValue || 0) : (decryptedAmount || property.publicValue1 || 100000);
    
    const marketValue = Math.round(bidAmount * (0.8 + Math.random() * 0.4));
    const bidCompetitiveness = Math.min(100, Math.round((bidAmount / marketValue) * 100));
    const priceTrend = Math.round(50 + (Math.random() * 50));
    const riskLevel = Math.max(10, Math.min(90, 100 - bidCompetitiveness + 20));
    const successProbability = Math.min(95, Math.round(bidCompetitiveness * 0.8 + (100 - riskLevel) * 0.2));

    return {
      marketValue,
      bidCompetitiveness,
      priceTrend,
      riskLevel,
      successProbability
    };
  };

  const renderStats = () => {
    const totalBids = properties.length;
    const verifiedBids = properties.filter(p => p.isVerified).length;
    const avgBidAmount = properties.length > 0 
      ? properties.reduce((sum, p) => sum + p.publicValue1, 0) / properties.length 
      : 0;
    
    const recentBids = properties.filter(p => 
      Date.now()/1000 - p.timestamp < 60 * 60 * 24 * 7
    ).length;

    return (
      <div className="stats-grid">
        <div className="stat-card copper-card">
          <h3>Total Bids</h3>
          <div className="stat-value">{totalBids}</div>
          <div className="stat-trend">+{recentBids} this week</div>
        </div>
        
        <div className="stat-card bronze-card">
          <h3>Verified Bids</h3>
          <div className="stat-value">{verifiedBids}/{totalBids}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="stat-card silver-card">
          <h3>Avg Bid Amount</h3>
          <div className="stat-value">${(avgBidAmount/1000).toFixed(1)}K</div>
          <div className="stat-trend">Encrypted</div>
        </div>
      </div>
    );
  };

  const renderBidChart = (property: PropertyBid, decryptedAmount: number | null) => {
    const analysis = analyzeBid(property, decryptedAmount);
    
    return (
      <div className="bid-analysis">
        <div className="chart-row">
          <div className="chart-label">Market Value</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, analysis.marketValue/10000)}%` }}
            >
              <span className="bar-value">${(analysis.marketValue/1000).toFixed(0)}K</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Bid Competitiveness</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.bidCompetitiveness}%` }}
            >
              <span className="bar-value">{analysis.bidCompetitiveness}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Market Trend</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.priceTrend}%` }}
            >
              <span className="bar-value">{analysis.priceTrend}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Risk Level</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${analysis.riskLevel}%` }}
            >
              <span className="bar-value">{analysis.riskLevel}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Success Probability</div>
          <div className="chart-bar">
            <div 
              className="bar-fill growth" 
              style={{ width: `${analysis.successProbability}%` }}
            >
              <span className="bar-value">{analysis.successProbability}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const filteredProperties = properties.filter(property =>
    property.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🏠 Confidential Real Estate Bidding</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Start Bidding</h2>
            <p>Secure your real estate bids with fully homomorphic encryption technology.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to access the encrypted bidding system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize for secure computations</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Submit encrypted bids and verify results with zero-knowledge proofs</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your real estate transactions</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Loading encrypted bidding platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🏠 Confidential Real Estate Bidding</h1>
          <p>FHE Protected Property Auctions</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowBidModal(true)} 
            className="submit-bid-btn"
          >
            🏷️ Submit Encrypted Bid
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Real Estate Bidding Analytics</h2>
          {renderStats()}
          
          <div className="search-section">
            <input
              type="text"
              placeholder="🔍 Search properties..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
        
        <div className="properties-section">
          <div className="section-header">
            <h2>Active Property Bids</h2>
            <div className="header-actions">
              <button 
                onClick={loadProperties} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄 Refreshing..." : "🔄 Refresh"}
              </button>
            </div>
          </div>
          
          <div className="properties-list">
            {filteredProperties.length === 0 ? (
              <div className="no-properties">
                <p>No property bids found</p>
                <button 
                  className="submit-bid-btn" 
                  onClick={() => setShowBidModal(true)}
                >
                  Submit First Bid
                </button>
              </div>
            ) : filteredProperties.map((property, index) => (
              <div 
                className={`property-item ${selectedProperty?.id === property.id ? "selected" : ""} ${property.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedProperty(property)}
              >
                <div className="property-title">{property.name}</div>
                <div className="property-description">{property.description}</div>
                <div className="property-meta">
                  <span>Created: {new Date(property.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="property-status">
                  Status: {property.isVerified ? "✅ Bid Verified" : "🔓 Ready for Verification"}
                  {property.isVerified && property.decryptedValue && (
                    <span className="verified-amount">Amount: ${property.decryptedValue}</span>
                  )}
                </div>
                <div className="property-creator">Bidder: {property.creator.substring(0, 6)}...{property.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="user-history">
          <h3>Your Bidding History</h3>
          <div className="history-list">
            {userHistory.slice(0, 5).map((record, index) => (
              <div key={index} className="history-item">
                <span className={`history-type ${record.type}`}>
                  {record.type === 'bid_submission' ? '📤' : '🔓'} 
                  {record.type.replace('_', ' ')}
                </span>
                <span className="history-details">
                  {record.property} - ${record.amount}
                </span>
                <span className="history-time">
                  {new Date(record.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {userHistory.length === 0 && (
              <div className="no-history">No bidding activity yet</div>
            )}
          </div>
        </div>
      </div>
      
      {showBidModal && (
        <BidModal 
          onSubmit={submitBid} 
          onClose={() => setShowBidModal(false)} 
          submitting={submittingBid} 
          bidData={newBidData} 
          setBidData={setNewBidData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedProperty && (
        <PropertyDetailModal 
          property={selectedProperty} 
          onClose={() => { 
            setSelectedProperty(null); 
            setDecryptedBid(null); 
          }} 
          decryptedBid={decryptedBid} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptBid={() => decryptBid(selectedProperty.id)}
          renderBidChart={renderBidChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="metal-spinner-small"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const BidModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  bidData: any;
  setBidData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, submitting, bidData, setBidData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'bidAmount') {
      const intValue = value.replace(/[^\d]/g, '');
      setBidData({ ...bidData, [name]: intValue });
    } else {
      setBidData({ ...bidData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="bid-modal">
        <div className="modal-header">
          <h2>Submit Encrypted Property Bid</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Your bid amount will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Property Name *</label>
            <input 
              type="text" 
              name="propertyName" 
              value={bidData.propertyName} 
              onChange={handleChange} 
              placeholder="Enter property name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Bid Amount (Integer only) *</label>
            <input 
              type="number" 
              name="bidAmount" 
              value={bidData.bidAmount} 
              onChange={handleChange} 
              placeholder="Enter bid amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Property Description *</label>
            <textarea 
              name="description" 
              value={bidData.description} 
              onChange={handleChange} 
              placeholder="Describe the property..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={submitting || isEncrypting || !bidData.propertyName || !bidData.bidAmount || !bidData.description} 
            className="submit-btn"
          >
            {submitting || isEncrypting ? "Encrypting and Submitting..." : "Submit Encrypted Bid"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PropertyDetailModal: React.FC<{
  property: PropertyBid;
  onClose: () => void;
  decryptedBid: number | null;
  isDecrypting: boolean;
  decryptBid: () => Promise<number | null>;
  renderBidChart: (property: PropertyBid, decryptedAmount: number | null) => JSX.Element;
}> = ({ property, onClose, decryptedBid, isDecrypting, decryptBid, renderBidChart }) => {
  const handleDecrypt = async () => {
    if (decryptedBid !== null) return;
    await decryptBid();
  };

  return (
    <div className="modal-overlay">
      <div className="property-detail-modal">
        <div className="modal-header">
          <h2>Property Bid Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="property-info">
            <div className="info-item">
              <span>Property:</span>
              <strong>{property.name}</strong>
            </div>
            <div className="info-item">
              <span>Bidder:</span>
              <strong>{property.creator.substring(0, 6)}...{property.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Submitted:</span>
              <strong>{new Date(property.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <strong>{property.description}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Bid Data</h3>
            
            <div className="data-row">
              <div className="data-label">Bid Amount:</div>
              <div className="data-value">
                {property.isVerified && property.decryptedValue ? 
                  `$${property.decryptedValue} (On-chain Verified)` : 
                  decryptedBid !== null ? 
                  `$${decryptedBid} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(property.isVerified || decryptedBid !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : property.isVerified ? (
                  "✅ Verified"
                ) : decryptedBid !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Bid"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Confidential Bidding</strong>
                <p>Your bid remains encrypted until verification. Only the winning bid amount is revealed.</p>
              </div>
            </div>
          </div>
          
          {(property.isVerified || decryptedBid !== null) && (
            <div className="analysis-section">
              <h3>Bid Competitiveness Analysis</h3>
              {renderBidChart(property, property.isVerified ? property.decryptedValue || null : decryptedBid)}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Your Bid:</span>
                  <strong>
                    {property.isVerified ? 
                      `$${property.decryptedValue} (Verified)` : 
                      `$${decryptedBid} (Decrypted)`
                    }
                  </strong>
                  <span className={`data-badge ${property.isVerified ? 'verified' : 'local'}`}>
                    {property.isVerified ? 'On-chain Verified' : 'Local Decryption'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!property.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


