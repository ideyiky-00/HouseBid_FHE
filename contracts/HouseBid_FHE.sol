pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HouseBid_FHE is ZamaEthereumConfig {
    struct Bid {
        euint32 encryptedAmount;
        address bidder;
        uint256 timestamp;
        bool isVerified;
        uint32 decryptedAmount;
    }

    struct Property {
        string propertyId;
        string details;
        uint256 startTime;
        uint256 endTime;
        address seller;
        bool isActive;
        Bid[] bids;
    }

    mapping(string => Property) public properties;
    string[] public propertyIds;

    event PropertyListed(
        string indexed propertyId,
        address indexed seller,
        uint256 startTime,
        uint256 endTime
    );

    event BidSubmitted(
        string indexed propertyId,
        address indexed bidder,
        euint32 encryptedAmount
    );

    event BidRevealed(
        string indexed propertyId,
        address indexed bidder,
        uint32 decryptedAmount
    );

    event AuctionConcluded(
        string indexed propertyId,
        address indexed winner,
        uint32 winningAmount
    );

    constructor() ZamaEthereumConfig() {}

    function listProperty(
        string calldata propertyId,
        string calldata details,
        uint256 duration
    ) external {
        require(bytes(properties[propertyId].propertyId).length == 0, "Property already listed");
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + duration;

        properties[propertyId] = Property({
            propertyId: propertyId,
            details: details,
            startTime: startTime,
            endTime: endTime,
            seller: msg.sender,
            isActive: true,
            bids: new Bid[](0)
        });

        propertyIds.push(propertyId);
        emit PropertyListed(propertyId, msg.sender, startTime, endTime);
    }

    function submitBid(
        string calldata propertyId,
        externalEuint32 encryptedAmount,
        bytes calldata inputProof
    ) external {
        Property storage property = properties[propertyId];
        require(block.timestamp >= property.startTime, "Bidding not started");
        require(block.timestamp <= property.endTime, "Bidding period ended");
        require(property.isActive, "Auction not active");

        euint32 amount = FHE.fromExternal(encryptedAmount, inputProof);
        require(FHE.isInitialized(amount), "Invalid encrypted amount");

        property.bids.push(Bid({
            encryptedAmount: amount,
            bidder: msg.sender,
            timestamp: block.timestamp,
            isVerified: false,
            decryptedAmount: 0
        }));

        FHE.allowThis(amount);
        FHE.makePubliclyDecryptable(amount);

        emit BidSubmitted(propertyId, msg.sender, amount);
    }

    function revealBid(
        string calldata propertyId,
        uint256 bidIndex,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        Property storage property = properties[propertyId];
        require(bidIndex < property.bids.length, "Invalid bid index");
        Bid storage bid = property.bids[bidIndex];
        require(!bid.isVerified, "Bid already revealed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(bid.encryptedAmount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decryptedAmount = abi.decode(abiEncodedClearValue, (uint32));
        bid.decryptedAmount = decryptedAmount;
        bid.isVerified = true;

        emit BidRevealed(propertyId, bid.bidder, decryptedAmount);
    }

    function determineWinner(string calldata propertyId) external {
        Property storage property = properties[propertyId];
        require(block.timestamp > property.endTime, "Auction still active");
        require(property.isActive, "Auction already concluded");

        uint32 highestAmount = 0;
        address winner = address(0);

        for (uint256 i = 0; i < property.bids.length; i++) {
            Bid storage bid = property.bids[i];
            require(bid.isVerified, "Some bids not revealed");

            if (bid.decryptedAmount > highestAmount) {
                highestAmount = bid.decryptedAmount;
                winner = bid.bidder;
            }
        }

        property.isActive = false;
        emit AuctionConcluded(propertyId, winner, highestAmount);
    }

    function getPropertyDetails(string calldata propertyId)
        external
        view
        returns (
            string memory,
            address,
            uint256,
            uint256,
            bool
        )
    {
        Property storage property = properties[propertyId];
        return (
            property.details,
            property.seller,
            property.startTime,
            property.endTime,
            property.isActive
        );
    }

    function getBid(string calldata propertyId, uint256 bidIndex)
        external
        view
        returns (
            euint32,
            address,
            uint256,
            bool,
            uint32
        )
    {
        Property storage property = properties[propertyId];
        Bid storage bid = property.bids[bidIndex];
        return (
            bid.encryptedAmount,
            bid.bidder,
            bid.timestamp,
            bid.isVerified,
            bid.decryptedAmount
        );
    }

    function getBidsCount(string calldata propertyId) external view returns (uint256) {
        return properties[propertyId].bids.length;
    }

    function getAllPropertyIds() external view returns (string[] memory) {
        return propertyIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


