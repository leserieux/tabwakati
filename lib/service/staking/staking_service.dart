// lib/services/staking/staking_service.dart
// ============================================================================
// STAKING SERVICE - Multi-pools
// RPCs : get_staking_pools / get_my_stakes (liste des pools + ma position)
//        fn_stake(p_amount, p_pool_id) / fn_unstake(p_amount, p_pool_id)
//        get_my_staking (résumé WAKATI, utilisé par le wallet et les prêts)
// ============================================================================

import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/cache_service.dart';
import '../../models/stake_model.dart';
import '../../models/staking_pool_model.dart';

class StakingService {
  static final StakingService _instance = StakingService._internal();
  factory StakingService() => _instance;
  StakingService._internal();

  final SupabaseClient _supabase = Supabase.instance.client;
  final CacheService _cache = CacheService();

  static const _timeout = Duration(seconds: 15);

  // ─────────────────────────────────────────────
  // LIRE L'ÉTAT DU STAKING
  // ─────────────────────────────────────────────

  /// Retourne l'état complet du staking de l'utilisateur connecté.
  /// Appelle get_my_staking() → jsonb
  Future<StakingState> getMyStaking({bool forceRefresh = false}) async {
    final userId = _supabase.auth.currentUser?.id;
    if (userId == null)
      throw StakingException('Non authentifié', code: 'AUTH_ERROR');

    final cacheKey = 'staking_state_$userId';

    return _cache.getWithCache<StakingState>(
      key: cacheKey,
      fetch: () async {
        final response = await _supabase
            .rpc('get_my_staking')
            .timeout(_timeout);

        if (response == null) return StakingState.empty();

        final Map<String, dynamic> data =
            response is Map<String, dynamic>
                ? response
                : Map<String, dynamic>.from(response as Map);

        return StakingState.fromJson(data);
      },
      memoryTtl: const Duration(seconds: 30),
      localTtl: const Duration(minutes: 10),
      skipLocal: true, // toujours frais depuis le réseau
      forceRefresh: forceRefresh,
    );
  }

  // ─────────────────────────────────────────────
  // POOLS (multi-actifs)
  // ─────────────────────────────────────────────

  /// Tous les pools actifs, avec la position de l'utilisateur dans chacun.
  /// Appelle get_staking_pools() + get_my_stakes() en parallèle.
  Future<List<StakingPoolModel>> getPools({bool forceRefresh = false}) async {
    final userId = _supabase.auth.currentUser?.id ?? 'anon';
    final cacheKey = 'staking_pools_$userId';

    return _cache.getWithCache<List<StakingPoolModel>>(
      key: cacheKey,
      fetch: () async {
        final results = await Future.wait([
          _supabase.rpc('get_staking_pools').timeout(_timeout),
          _supabase.rpc('get_my_stakes').timeout(_timeout),
        ]);

        final pools = _asMapList(results[0]);
        final stakes = _asMapList(results[1]);
        final stakeByPool = {
          for (final s in stakes) s['pool_id'].toString(): s,
        };

        return pools.map((json) {
          final pool = StakingPoolModel.fromJson(json);
          final stake = stakeByPool[pool.id];
          return stake != null ? pool.withUserStake(stake) : pool;
        }).toList();
      },
      memoryTtl: const Duration(seconds: 30),
      localTtl: const Duration(minutes: 10),
      skipLocal: true,
      forceRefresh: forceRefresh,
    );
  }

  static List<Map<String, dynamic>> _asMapList(dynamic response) {
    if (response is! List) return const [];
    return response
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  // ─────────────────────────────────────────────
  // STAKER
  // ─────────────────────────────────────────────

  /// Transfère [amount] WAKATI du solde disponible vers le staking.
  /// Appelle fn_stake(p_amount) → jsonb
  Future<StakeResult> stake(double amount, {String? poolId}) async {
    if (_supabase.auth.currentUser == null) {
      throw StakingException('Non authentifié', code: 'AUTH_ERROR');
    }
    if (amount <= 0) {
      throw StakingException('Montant invalide', code: 'INVALID_AMOUNT');
    }

    try {
      final response = await _supabase
          .rpc(
            'fn_stake',
            params: {
              'p_amount': amount,
              if (poolId != null) 'p_pool_id': poolId,
            },
          )
          .timeout(_timeout);

      final Map<String, dynamic> data =
          response is Map<String, dynamic>
              ? response
              : Map<String, dynamic>.from(response as Map);

      if (data['success'] != true) {
        throw StakingException(
          data['error'] as String? ?? 'Staking échoué',
          code: 'STAKE_FAILED',
        );
      }

      // Invalider le cache pour forcer un rechargement
      _invalidateCache();

      return StakeResult.fromJson(data);
    } on StakingException {
      rethrow;
    } catch (e) {
      throw StakingException(
        'Erreur lors du staking: $e',
        code: 'UNKNOWN_ERROR',
      );
    }
  }

  // ─────────────────────────────────────────────
  // UNSTAKER
  // ─────────────────────────────────────────────

  /// Retire [amount] WAKATI du staking vers le solde disponible.
  /// Les rewards en attente sont versés automatiquement.
  /// Appelle fn_unstake(p_amount) → jsonb
  Future<UnstakeResult> unstake(double amount, {String? poolId}) async {
    if (_supabase.auth.currentUser == null) {
      throw StakingException('Non authentifié', code: 'AUTH_ERROR');
    }
    if (amount <= 0) {
      throw StakingException('Montant invalide', code: 'INVALID_AMOUNT');
    }

    try {
      final response = await _supabase
          .rpc(
            'fn_unstake',
            params: {
              'p_amount': amount,
              if (poolId != null) 'p_pool_id': poolId,
            },
          )
          .timeout(_timeout);

      final Map<String, dynamic> data =
          response is Map<String, dynamic>
              ? response
              : Map<String, dynamic>.from(response as Map);

      if (data['success'] != true) {
        throw StakingException(
          data['error'] as String? ?? 'Unstaking échoué',
          code: 'UNSTAKE_FAILED',
        );
      }

      _invalidateCache();

      return UnstakeResult.fromJson(data);
    } on StakingException {
      rethrow;
    } catch (e) {
      throw StakingException(
        'Erreur lors du retrait: $e',
        code: 'UNKNOWN_ERROR',
      );
    }
  }

  // ─────────────────────────────────────────────
  // CACHE
  // ─────────────────────────────────────────────

  void _invalidateCache() {
    final userId = _supabase.auth.currentUser?.id;
    if (userId != null) {
      _cache.invalidate('staking_state_$userId');
      _cache.invalidate('staking_pools_$userId');
    }
  }

  void clearCache() => _invalidateCache();
}
