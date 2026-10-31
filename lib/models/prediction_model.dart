// lib/models/prediction_model.dart

class PredictionConfig {
  final String assetSymbol;
  final String assetName;
  final double betAmount;
  final String betMode;
  final double betMin;
  final double betMax;
  final double winMultiplier;
  final int durationSeconds;
  final int maxBetsPerDay;
  final int cooldownSeconds;
  final String currencySymbol;
  final bool isActive;

  const PredictionConfig({
    required this.assetSymbol,
    required this.assetName,
    required this.betAmount,
    required this.betMode,
    required this.betMin,
    required this.betMax,
    required this.winMultiplier,
    required this.durationSeconds,
    required this.maxBetsPerDay,
    required this.cooldownSeconds,
    required this.currencySymbol,
    required this.isActive,
  });

  factory PredictionConfig.fromJson(Map<String, dynamic> j) => PredictionConfig(
    assetSymbol: j['asset_symbol'] as String? ?? 'BTC',
    assetName: j['asset_name'] as String? ?? 'Bitcoin',
    betAmount: _d(j['bet_amount']),
    betMode: j['bet_mode'] as String? ?? 'fixed',
    betMin: _d(j['bet_min']),
    betMax: _d(j['bet_max']),
    winMultiplier: _d(j['win_multiplier']),
    durationSeconds: j['duration_seconds'] as int? ?? 300,
    maxBetsPerDay: j['max_bets_per_day'] as int? ?? 20,
    cooldownSeconds: j['cooldown_seconds'] as int? ?? 30,
    currencySymbol: j['currency_symbol'] as String? ?? 'WAKATI',
    isActive: j['is_active'] as bool? ?? true,
  );

  double get potentialWin => betAmount * winMultiplier;

  static double _d(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }
}

// ✅ FIX : durationSeconds en camelCase (était duration_seconds → erreur getter)
class PredictionBet {
  final String id;
  final String direction;
  final double betAmount;
  final double priceAtBet;
  final double? priceAtResolution;
  final DateTime betAt;
  final DateTime resolvesAt;
  final DateTime? resolvedAt;
  final String status;
  final double? payoutAmount;
  final double? profitAmount;
  final double winMultiplier;
  final int durationSeconds;
  final String assetSymbol;

  const PredictionBet({
    required this.id,
    required this.direction,
    required this.betAmount,
    required this.priceAtBet,
    this.priceAtResolution,
    required this.betAt,
    required this.resolvesAt,
    this.resolvedAt,
    required this.status,
    this.payoutAmount,
    this.profitAmount,
    required this.winMultiplier,
    required this.durationSeconds,
    required this.assetSymbol,
  });

  factory PredictionBet.fromJson(Map<String, dynamic> j) => PredictionBet(
    id: j['id'] as String? ?? '',
    direction: j['direction'] as String? ?? 'UP',
    betAmount: _d(j['bet_amount']),
    priceAtBet: _d(j['price_at_bet']),
    priceAtResolution:
        j['price_at_resolution'] != null ? _d(j['price_at_resolution']) : null,
    betAt: _dt(j['bet_at']),
    resolvesAt: _dt(j['resolves_at']),
    resolvedAt: j['resolved_at'] != null ? _dt(j['resolved_at']) : null,
    status: j['status'] as String? ?? 'pending',
    payoutAmount: j['payout_amount'] != null ? _d(j['payout_amount']) : null,
    profitAmount: j['profit_amount'] != null ? _d(j['profit_amount']) : null,
    winMultiplier: _d(j['win_multiplier']),
    durationSeconds: j['duration_seconds'] as int? ?? 300,
    assetSymbol: j['asset_symbol'] as String? ?? 'BTC',
  );

  bool get isPending => status == 'pending';
  bool get isWon => status == 'won';
  bool get isLost => status == 'lost';
  bool get isCancelled => status == 'cancelled';

  int get secondsLeft =>
      resolvesAt.difference(DateTime.now()).inSeconds.clamp(0, 9999);

  static double _d(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }

  static DateTime _dt(dynamic v) =>
      v != null
          ? DateTime.tryParse(v.toString()) ?? DateTime.now()
          : DateTime.now();
}

class PredictionStats {
  final int totalBets;
  final int totalWins;
  final int totalLosses;
  final double totalWagered;
  final double totalWon;
  final double totalLost;
  final double netProfit;
  final int winStreak;
  final int bestWinStreak;
  final int lossStreak;

  const PredictionStats({
    required this.totalBets,
    required this.totalWins,
    required this.totalLosses,
    required this.totalWagered,
    required this.totalWon,
    required this.totalLost,
    required this.netProfit,
    required this.winStreak,
    required this.bestWinStreak,
    required this.lossStreak,
  });

  factory PredictionStats.fromJson(Map<String, dynamic> j) => PredictionStats(
    totalBets: j['total_bets'] as int? ?? 0,
    totalWins: j['total_wins'] as int? ?? 0,
    totalLosses: j['total_losses'] as int? ?? 0,
    totalWagered: _d(j['total_wagered']),
    totalWon: _d(j['total_won']),
    totalLost: _d(j['total_lost']),
    netProfit: _d(j['net_profit']),
    winStreak: j['win_streak'] as int? ?? 0,
    bestWinStreak: j['best_win_streak'] as int? ?? 0,
    lossStreak: j['loss_streak'] as int? ?? 0,
  );

  factory PredictionStats.empty() => const PredictionStats(
    totalBets: 0,
    totalWins: 0,
    totalLosses: 0,
    totalWagered: 0,
    totalWon: 0,
    totalLost: 0,
    netProfit: 0,
    winStreak: 0,
    bestWinStreak: 0,
    lossStreak: 0,
  );

  double get winRate => totalBets == 0 ? 0 : (totalWins / totalBets * 100);

  static double _d(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }
}

class PredictionState {
  final PredictionConfig config;
  final double balance;
  final int betsToday;
  final PredictionBet? activeBet;
  final PredictionStats stats;
  final List<PredictionBet> history;

  const PredictionState({
    required this.config,
    required this.balance,
    required this.betsToday,
    this.activeBet,
    required this.stats,
    required this.history,
  });

  factory PredictionState.fromJson(Map<String, dynamic> j) => PredictionState(
    config: PredictionConfig.fromJson(
      j['config'] as Map<String, dynamic>? ?? {},
    ),
    balance: _d(j['balance']),
    betsToday: j['bets_today'] as int? ?? 0,
    activeBet:
        j['active_bet'] != null
            ? PredictionBet.fromJson(j['active_bet'] as Map<String, dynamic>)
            : null,
    stats:
        j['stats'] != null && (j['stats'] as Map).isNotEmpty
            ? PredictionStats.fromJson(j['stats'] as Map<String, dynamic>)
            : PredictionStats.empty(),
    history:
        j['history'] != null
            ? (j['history'] as List)
                .map((e) => PredictionBet.fromJson(e as Map<String, dynamic>))
                .toList()
            : [],
  );

  bool get canBet =>
      activeBet == null && betsToday < config.maxBetsPerDay && config.isActive;

  static double _d(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }
}

class BetResult {
  final bool success;
  final String status;
  final bool? won;
  final double priceAtBet;
  final double priceAtResolution;
  final double betAmount;
  final double payoutAmount;
  final double profitAmount;
  final String? error;
  final String? direction;

  const BetResult({
    required this.success,
    required this.status,
    this.won,
    required this.priceAtBet,
    required this.priceAtResolution,
    required this.betAmount,
    required this.payoutAmount,
    required this.profitAmount,
    this.error,
    this.direction,
  });

  bool get isWon => status == 'won';
  bool get isLost => status == 'lost';
  bool get isRefunded => status == 'cancelled';

  factory BetResult.fromJson(Map<String, dynamic> j) => BetResult(
    success: j['success'] as bool? ?? false,
    status: j['status'] as String? ?? '',
    won: j['won'] as bool?,
    priceAtBet: _d(j['price_at_bet']),
    priceAtResolution: _d(j['price_at_resolution']),
    betAmount: _d(j['bet_amount']),
    payoutAmount: _d(j['payout_amount']),
    profitAmount: _d(j['profit_amount']),
    error: j['error'] as String?,
    direction: j['direction'] as String?,
  );

  static double _d(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }
}
