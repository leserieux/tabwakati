// lib/models/staking_pool_model.dart
// ============================================================================
// STAKING POOL MODEL - Version corrigée avec mapping des champs RPC
// ============================================================================

/// Mode APY du pool
enum ApyMode {
  fixed,
  dynamic,
  launchpool;

  static ApyMode fromString(String mode) {
    switch (mode.toLowerCase()) {
      case 'fixed':
        return ApyMode.fixed;
      case 'dynamic':
        return ApyMode.dynamic;
      case 'launchpool':
        return ApyMode.launchpool;
      default:
        return ApyMode.fixed;
    }
  }

  String get displayName {
    switch (this) {
      case ApyMode.fixed:
        return 'APY Fixe';
      case ApyMode.dynamic:
        return 'APY Dynamique';
      case ApyMode.launchpool:
        return 'Launchpool';
    }
  }
}

/// Pool de staking actif
class StakingPoolModel {
  final String id;
  final String name;
  final String assetSymbol;
  final String? rewardAssetSymbol;
  final ApyMode apyMode;
  final double baseApy;
  final double totalApy;
  final double minStakeAmount;
  final double? maxStakeAmount;
  final double totalStaked;
  final double? maxPoolCapacity;
  final int lockPeriodDays;
  final bool instantUnstakeEnabled;
  final double? instantUnstakeFeePercent;
  final bool isActive;
  final bool isLaunchpool;
  final DateTime? startDate;
  final DateTime? endDate;
  // Champs spécifiques launchpool
  final double? totalRewardsBudget;
  final double? remainingRewards;
  final double? rewardsFillPercent;
  // Données utilisateur (si connecté)
  final double? userStakedAmount;
  final double? userPendingRewards;
  final bool? userHasStake;
  final double assetPriceUsd;
  final double rewardPriceUsd;
  final String? description;
  // Déblocage de la position de l'utilisateur (pool bloqué)
  final DateTime? unlockAt;
  // Part de la position bloquée en garantie d'un prêt
  final double userLockedAmount;

  const StakingPoolModel({
    required this.id,
    required this.name,
    required this.assetSymbol,
    this.rewardAssetSymbol,
    required this.apyMode,
    required this.baseApy,
    required this.totalApy,
    required this.minStakeAmount,
    this.maxStakeAmount,
    required this.totalStaked,
    this.maxPoolCapacity,
    required this.lockPeriodDays,
    required this.instantUnstakeEnabled,
    this.instantUnstakeFeePercent,
    required this.isActive,
    required this.isLaunchpool,
    this.startDate,
    this.endDate,
    this.totalRewardsBudget,
    this.remainingRewards,
    this.rewardsFillPercent,
    this.userStakedAmount,
    this.userPendingRewards,
    this.userHasStake,
    this.assetPriceUsd = 0.0,
    this.rewardPriceUsd = 0.0,
    this.description,
    this.unlockAt,
    this.userLockedAmount = 0.0,
  });

  factory StakingPoolModel.fromJson(Map<String, dynamic> json) {
    return StakingPoolModel(
      // ✅ CORRECTION: Utiliser 'pool_id' au lieu de 'id' (champ de la réponse RPC)
      id: json['pool_id']?.toString() ?? json['id']?.toString() ?? '',
      name: json['pool_name']?.toString() ?? json['name']?.toString() ?? '',
      assetSymbol: json['asset_symbol']?.toString() ?? '',
      rewardAssetSymbol: json['reward_asset_symbol']?.toString(),
      apyMode: ApyMode.fromString(json['apy_mode'] as String? ?? 'fixed'),
      baseApy: _toDouble(json['base_apy']),
      // ✅ Utiliser current_apy si disponible, sinon base_apy
      totalApy: _toDouble(json['current_apy'] ?? json['base_apy']),
      // ✅ CORRECTION: Utiliser 'min_stake' (champ de la réponse RPC)
      minStakeAmount: _toDouble(json['min_stake']),
      maxStakeAmount:
          json['max_stake'] != null ? _toDouble(json['max_stake']) : null,
      totalStaked: _toDouble(json['total_staked']),
      // ✅ CORRECTION: Utiliser 'total_capacity' (champ de la réponse RPC)
      maxPoolCapacity:
          json['total_capacity'] != null
              ? _toDouble(json['total_capacity'])
              : null,
      lockPeriodDays: (json['lock_period_days'] as num?)?.toInt() ?? 0,
      instantUnstakeEnabled: json['instant_unstake_enabled'] as bool? ?? false,
      instantUnstakeFeePercent:
          json['instant_unstake_fee_percent'] != null
              ? _toDouble(json['instant_unstake_fee_percent'])
              : null,
      isActive: json['is_active'] as bool? ?? true,
      isLaunchpool: (json['apy_mode'] as String? ?? '') == 'launchpool',
      startDate:
          json['start_date'] != null
              ? DateTime.tryParse(json['start_date'] as String)
              : null,
      // ✅ CORRECTION: Utiliser 'launchpool_end_date' (champ de la réponse RPC)
      endDate:
          json['launchpool_end_date'] != null
              ? DateTime.tryParse(json['launchpool_end_date'] as String)
              : null,
      // ✅ CORRECTION: Utiliser 'launchpool_total_rewards' (champ de la réponse RPC)
      totalRewardsBudget:
          json['launchpool_total_rewards'] != null
              ? _toDouble(json['launchpool_total_rewards'])
              : null,
      // ✅ CORRECTION: Utiliser 'launchpool_rewards_left' (champ de la réponse RPC)
      remainingRewards:
          json['launchpool_rewards_left'] != null
              ? _toDouble(json['launchpool_rewards_left'])
              : null,
      rewardsFillPercent:
          json['rewards_fill_percent'] != null
              ? _toDouble(json['rewards_fill_percent'])
              : null,
      userStakedAmount:
          json['user_staked_amount'] != null
              ? _toDouble(json['user_staked_amount'])
              : null,
      userPendingRewards:
          json['user_pending_rewards'] != null
              ? _toDouble(json['user_pending_rewards'])
              : null,
      userHasStake: _toDouble(json['user_staked_amount']) > 0,
      assetPriceUsd: _toDouble(json['asset_price_usd']),
      rewardPriceUsd: _toDouble(json['reward_price_usd']),
      description: json['description']?.toString(),
      unlockAt:
          json['unlock_at'] != null
              ? DateTime.tryParse(json['unlock_at'].toString())
              : null,
      userLockedAmount: _toDouble(json['user_locked_amount']),
    );
  }

  /// Fusionne la position de l'utilisateur (get_my_stakes) dans le pool.
  /// Apporte la part bloquée par un prêt, absente de get_staking_pools.
  StakingPoolModel withUserStake(Map<String, dynamic> stake) {
    return StakingPoolModel(
      id: id,
      name: name,
      assetSymbol: assetSymbol,
      rewardAssetSymbol: rewardAssetSymbol,
      apyMode: apyMode,
      baseApy: baseApy,
      totalApy: totalApy,
      minStakeAmount: minStakeAmount,
      maxStakeAmount: maxStakeAmount,
      totalStaked: totalStaked,
      maxPoolCapacity: maxPoolCapacity,
      lockPeriodDays: lockPeriodDays,
      instantUnstakeEnabled: instantUnstakeEnabled,
      instantUnstakeFeePercent: instantUnstakeFeePercent,
      isActive: isActive,
      isLaunchpool: isLaunchpool,
      startDate: startDate,
      endDate: endDate,
      totalRewardsBudget: totalRewardsBudget,
      remainingRewards: remainingRewards,
      rewardsFillPercent: rewardsFillPercent,
      userStakedAmount: _toDouble(stake['staked']),
      userPendingRewards: _toDouble(stake['pending_rewards']),
      userHasStake: _toDouble(stake['staked']) > 0,
      assetPriceUsd: assetPriceUsd,
      rewardPriceUsd: rewardPriceUsd,
      description: description,
      unlockAt:
          stake['unlock_at'] != null
              ? DateTime.tryParse(stake['unlock_at'].toString())
              : unlockAt,
      userLockedAmount: _toDouble(stake['locked_amount']),
    );
  }

  Map<String, dynamic> toJson() => {
    'pool_id': id,
    'pool_name': name,
    'asset_symbol': assetSymbol,
    'reward_asset_symbol': rewardAssetSymbol,
    'apy_mode': apyMode.toString().split('.').last,
    'base_apy': baseApy,
    'current_apy': totalApy,
    'min_stake': minStakeAmount,
    'max_stake': maxStakeAmount,
    'total_staked': totalStaked,
    'total_capacity': maxPoolCapacity,
    'lock_period_days': lockPeriodDays,
    'instant_unstake_enabled': instantUnstakeEnabled,
    'instant_unstake_fee_percent': instantUnstakeFeePercent,
    'is_active': isActive,
    'is_launchpool': isLaunchpool,
    'start_date': startDate?.toIso8601String(),
    'launchpool_end_date': endDate?.toIso8601String(),
    'launchpool_total_rewards': totalRewardsBudget,
    'launchpool_rewards_left': remainingRewards,
    'rewards_fill_percent': rewardsFillPercent,
    'user_staked_amount': userStakedAmount,
    'user_pending_rewards': userPendingRewards,
    'user_has_stake': userHasStake,
    'asset_price_usd': assetPriceUsd,
    'reward_price_usd': rewardPriceUsd,
    'description': description,
    'unlock_at': unlockAt?.toIso8601String(),
    'user_locked_amount': userLockedAmount,
  };

  /// Capacité utilisée en pourcentage
  double get capacityFillPercent {
    if (maxPoolCapacity == null || maxPoolCapacity! <= 0) return 0;
    return (totalStaked / maxPoolCapacity! * 100).clamp(0, 100);
  }

  bool get isFull => maxPoolCapacity != null && totalStaked >= maxPoolCapacity!;

  bool get isExpired => endDate != null && DateTime.now().isAfter(endDate!);

  bool get hasNoLock => lockPeriodDays == 0;

  /// Position de l'utilisateur encore verrouillée (pool bloqué)
  bool get isUserLocked =>
      unlockAt != null && DateTime.now().isBefore(unlockAt!);

  /// Montant que l'utilisateur peut retirer (hors garantie de prêt)
  double get userUnstakable =>
      ((userStakedAmount ?? 0) - userLockedAmount).clamp(0, double.infinity);

  /// Peut-on encore staker dans ce pool ?
  bool get canStake => isActive && !isFull && !isExpired && !isLaunchpoolExhausted;

  bool get isLaunchpoolExhausted =>
      isLaunchpool && remainingRewards != null && remainingRewards! <= 0;

  static double _toDouble(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }

  @override
  String toString() =>
      'StakingPoolModel(id: $id, name: $name, apy: $totalApy%, mode: ${apyMode.displayName})';

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is StakingPoolModel && other.id == id;

  @override
  int get hashCode => id.hashCode;
}

/// Résultat du calcul APY (calculate_pool_apy)
class PoolApyResultModel {
  final String poolId;
  final double baseApy;
  final double bonusApy;
  final double totalApy;
  final double estimatedDailyReward;
  final double estimatedMonthlyReward;
  final double estimatedYearlyReward;

  const PoolApyResultModel({
    required this.poolId,
    required this.baseApy,
    required this.bonusApy,
    required this.totalApy,
    required this.estimatedDailyReward,
    required this.estimatedMonthlyReward,
    required this.estimatedYearlyReward,
  });

  factory PoolApyResultModel.fromJson(Map<String, dynamic> json) {
    return PoolApyResultModel(
      poolId: json['pool_id'] as String? ?? '',
      baseApy: _toDouble(json['base_apy']),
      bonusApy: _toDouble(json['bonus_apy']),
      totalApy: _toDouble(json['total_apy']),
      estimatedDailyReward: _toDouble(json['estimated_daily_reward']),
      estimatedMonthlyReward: _toDouble(json['estimated_monthly_reward']),
      estimatedYearlyReward: _toDouble(json['estimated_yearly_reward']),
    );
  }

  static double _toDouble(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }
}
