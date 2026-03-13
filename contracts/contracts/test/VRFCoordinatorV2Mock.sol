// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Minimal mock of Chainlink VRFCoordinatorV2 for local testing.
// Allows manual fulfilment of randomness requests.

import "@chainlink/contracts/src/v0.8/vrf/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";

contract VRFCoordinatorV2Mock is VRFCoordinatorV2Interface {
    uint96 internal _baseFee;
    uint96 internal _gasPriceLink;
    uint16 public constant MAX_CONSUMERS = 100;

    error InvalidSubscription();
    error InsufficientBalance();
    error MustBeSubOwner(address owner);

    event RandomWordsRequested(
        bytes32 indexed keyHash,
        uint256 requestId,
        uint256 preSeed,
        uint64  indexed subId,
        uint16  minimumRequestConfirmations,
        uint32  callbackGasLimit,
        uint32  numWords,
        address indexed sender
    );
    event RandomWordsFulfilled(uint256 indexed requestId, uint256 outputSeed, uint96 payment, bool success);

    struct Subscription {
        address owner;
        uint96 balance;
        address[] consumers;
    }

    uint64 private _currentSubId;
    uint256 private _currentRequestId;
    mapping(uint64 => Subscription) private _subscriptions;
    mapping(uint256 => address) private _pendingRequests; // reqId → consumer

    constructor(uint96 baseFee, uint96 gasPriceLink) {
        _baseFee = baseFee;
        _gasPriceLink = gasPriceLink;
    }

    function getRequestConfig()
        external
        pure
        override
        returns (uint16, uint32, bytes32[] memory)
    {
        bytes32[] memory keyhashes = new bytes32[](0);
        return (3, 2_500_000, keyhashes);
    }

    function createSubscription() external override returns (uint64 subId) {
        _currentSubId++;
        subId = _currentSubId;
        _subscriptions[subId].owner = msg.sender;
    }

    function getSubscription(uint64 subId)
        external
        view
        override
        returns (uint96 balance, uint64 reqCount, address owner, address[] memory consumers)
    {
        Subscription storage sub = _subscriptions[subId];
        return (sub.balance, 0, sub.owner, sub.consumers);
    }

    function requestSubscriptionOwnerTransfer(uint64, address) external pure override {
        revert("Not implemented");
    }

    function acceptSubscriptionOwnerTransfer(uint64) external pure override {
        revert("Not implemented");
    }

    function addConsumer(uint64 subId, address consumer) external override {
        _subscriptions[subId].consumers.push(consumer);
    }

    function removeConsumer(uint64 subId, address consumer) external override {
        address[] storage consumers = _subscriptions[subId].consumers;
        for (uint256 i = 0; i < consumers.length; i++) {
            if (consumers[i] == consumer) {
                consumers[i] = consumers[consumers.length - 1];
                consumers.pop();
                break;
            }
        }
    }

    function cancelSubscription(uint64 subId, address to) external override {
        Subscription storage sub = _subscriptions[subId];
        require(sub.owner == msg.sender, "Not owner");
        uint96 bal = sub.balance;
        delete _subscriptions[subId];
        if (bal > 0) {
            (bool ok,) = to.call{value: bal}("");
            require(ok);
        }
    }

    function pendingRequestExists(uint64) external pure override returns (bool) {
        return false;
    }

    function requestRandomWords(
        bytes32 keyHash,
        uint64  subId,
        uint16  minimumRequestConfirmations,
        uint32  callbackGasLimit,
        uint32  numWords
    ) external override returns (uint256 requestId) {
        _currentRequestId++;
        requestId = _currentRequestId;
        _pendingRequests[requestId] = msg.sender;

        emit RandomWordsRequested(
            keyHash,
            requestId,
            0,
            subId,
            minimumRequestConfirmations,
            callbackGasLimit,
            numWords,
            msg.sender
        );
    }

    /**
     * @notice Manually fulfil a pending request with provided random words.
     *         Used by tests to control randomness outcomes.
     */
    function fulfillRandomWords(uint256 requestId, uint256[] memory words) external {
        address consumer = _pendingRequests[requestId];
        require(consumer != address(0), "Unknown request");
        delete _pendingRequests[requestId];

        VRFConsumerBaseV2(consumer).rawFulfillRandomWords(requestId, words);

        emit RandomWordsFulfilled(requestId, words[0], 0, true);
    }

    /**
     * @notice Fulfil with a deterministic seed derived from requestId.
     */
    function fulfillRandomWordsWithSeed(uint256 requestId, uint256 seed) external {
        uint256[] memory words = new uint256[](1);
        words[0] = uint256(keccak256(abi.encode(seed, requestId)));
        this.fulfillRandomWords(requestId, words);
    }
}
