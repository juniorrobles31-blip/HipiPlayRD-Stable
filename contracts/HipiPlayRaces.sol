// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract HipiPlayRaces {
    address public owner;
    uint256 public raceCounter;
    uint8 public constant HORSE_COUNT = 6;

    enum RaceStatus {
        Open,
        Closed,
        Finished,
        Cancelled
    }

    struct Bet {
        address player;
        uint8 horse;
        uint256 amount;
        bool paid;
    }

    struct Race {
        uint256 id;
        bytes32 serverSeedHash;
        string revealedSeed;
        uint8 winningHorse;
        uint256 totalPool;
        uint256 totalWinningPool;
        RaceStatus status;
    }

    mapping(uint256 => Race) public races;
    mapping(uint256 => Bet[]) public raceBets;
    mapping(uint256 => mapping(uint8 => uint256)) public horsePools;

    event RaceCreated(uint256 indexed raceId, bytes32 serverSeedHash);
    event BetPlaced(uint256 indexed raceId, address indexed player, uint8 horse, uint256 amount);
    event RaceClosed(uint256 indexed raceId);
    event RaceFinished(uint256 indexed raceId, uint8 winningHorse, string revealedSeed);
    event PrizePaid(uint256 indexed raceId, address indexed player, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function createRace(bytes32 serverSeedHash) external onlyOwner {
        raceCounter++;

        races[raceCounter] = Race({
            id: raceCounter,
            serverSeedHash: serverSeedHash,
            revealedSeed: "",
            winningHorse: 0,
            totalPool: 0,
            totalWinningPool: 0,
            status: RaceStatus.Open
        });

        emit RaceCreated(raceCounter, serverSeedHash);
    }

    function placeBet(uint256 raceId, uint8 horse) external payable {
        Race storage race = races[raceId];

        require(race.status == RaceStatus.Open, "Race not open");
        require(horse >= 1 && horse <= HORSE_COUNT, "Invalid horse");
        require(msg.value > 0, "Bet amount must be greater than zero");

        raceBets[raceId].push(Bet({
            player: msg.sender,
            horse: horse,
            amount: msg.value,
            paid: false
        }));

        race.totalPool += msg.value;
        horsePools[raceId][horse] += msg.value;

        emit BetPlaced(raceId, msg.sender, horse, msg.value);
    }

    function closeRace(uint256 raceId) external onlyOwner {
        Race storage race = races[raceId];

        require(race.status == RaceStatus.Open, "Race not open");

        race.status = RaceStatus.Closed;

        emit RaceClosed(raceId);
    }

    function revealResult(uint256 raceId, string calldata serverSeed) external onlyOwner {
        Race storage race = races[raceId];

        require(race.status == RaceStatus.Closed, "Race must be closed first");
        require(
            keccak256(abi.encodePacked(serverSeed)) == race.serverSeedHash,
            "Invalid seed"
        );

        uint256 randomNumber = uint256(
            keccak256(
                abi.encodePacked(
                    serverSeed,
                    blockhash(block.number - 1),
                    raceId,
                    address(this)
                )
            )
        );

        uint8 winningHorse = uint8((randomNumber % HORSE_COUNT) + 1);

        race.revealedSeed = serverSeed;
        race.winningHorse = winningHorse;
        race.totalWinningPool = horsePools[raceId][winningHorse];
        race.status = RaceStatus.Finished;

        emit RaceFinished(raceId, winningHorse, serverSeed);
    }

    function claimPrize(uint256 raceId, uint256 betIndex) external {
        Race storage race = races[raceId];

        require(race.status == RaceStatus.Finished, "Race not finished");
        require(betIndex < raceBets[raceId].length, "Invalid bet index");

        Bet storage bet = raceBets[raceId][betIndex];

        require(bet.player == msg.sender, "Not your bet");
        require(!bet.paid, "Already paid");
        require(bet.horse == race.winningHorse, "Bet did not win");
        require(race.totalWinningPool > 0, "No winning pool");

        uint256 prize = (bet.amount * race.totalPool) / race.totalWinningPool;

        bet.paid = true;

        payable(msg.sender).transfer(prize);

        emit PrizePaid(raceId, msg.sender, prize);
    }

    function getBetsCount(uint256 raceId) external view returns (uint256) {
        return raceBets[raceId].length;
    }

    function getHorsePool(uint256 raceId, uint8 horse) external view returns (uint256) {
        return horsePools[raceId][horse];
    }
}