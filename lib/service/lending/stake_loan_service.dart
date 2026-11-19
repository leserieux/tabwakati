// lib/service/lending/stake_loan_service.dart
//
// Prêt adossé au staking (WAKATI, BTC, MATIC, FCFA… selon la config). Toutes les règles (LTV, frais, plafonds,
// liquidité trésorerie, échéance/grâce, saisie) sont appliquées côté BDD ;
// les RPC s'appuient sur auth.uid(), aucun user_id n'est transmis.
//
//   fn_get_stake_loan_options()            → ce que je peux emprunter
//   fn_get_my_stake_loans()                → mes prêts (LTV/phase en direct) + historique
//   fn_open_stake_loan(asset, montant, durée, garantie)
//   fn_repay_loan(id, montant)             → libère la garantie si tout est payé
//   fn_extend_stake_loan(id, preview)      → prolongation (frais) ou aperçu

import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/error_handler.dart';
import '../../models/stake_loan_model.dart';

class StakeLoanService {
  static final StakeLoanService _instance = StakeLoanService._internal();
  factory StakeLoanService() => _instance;
  StakeLoanService._internal();

  final SupabaseClient _supabase = Supabase.instance.client;
  final ErrorHandler _errorHandler = ErrorHandler();

  static const _rpcTimeout = Duration(seconds: 15);

  Map<String, dynamic> _asMap(dynamic response) =>
      Map<String, dynamic>.from(response as Map);

  // ══════════════════════════════════════════════════════════════
  // LECTURE (jamais de cache : le risque de saisie doit être frais)
  // ══════════════════════════════════════════════════════════════

  Future<StakeLoanOptions> getOptions() async {
    try {
      final response = await _supabase
          .rpc('fn_get_stake_loan_options')
          .timeout(_rpcTimeout);
      final json = _asMap(response);
      if (json['success'] == false) {
        throw StakeLoanException(json['error'] as String? ?? 'Erreur');
      }
      return StakeLoanOptions.fromJson(json);
    } catch (e, st) {
      _errorHandler.handle(e, st, 'StakeLoanService.getOptions');
      rethrow;
    }
  }

  Future<MyStakeLoans> getMyLoans({int historyLimit = 30}) async {
    try {
      final response = await _supabase
          .rpc(
            'fn_get_my_stake_loans',
            params: {'p_history_limit': historyLimit},
          )
          .timeout(_rpcTimeout);
      final json = _asMap(response);
      if (json['success'] == false) {
        throw StakeLoanException(json['error'] as String? ?? 'Erreur');
      }
      return MyStakeLoans(
        active:
            ((json['active'] as List?) ?? const [])
                .map(
                  (e) =>
                      StakeLoan.fromJson(Map<String, dynamic>.from(e as Map)),
                )
                .toList(),
        history:
            ((json['history'] as List?) ?? const [])
                .map(
                  (e) => StakeLoanRecord.fromJson(
                    Map<String, dynamic>.from(e as Map),
                  ),
                )
                .toList(),
      );
    } catch (e, st) {
      _errorHandler.handle(e, st, 'StakeLoanService.getMyLoans');
      rethrow;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ACTIONS
  // ══════════════════════════════════════════════════════════════

  Future<StakeLoanActionResult> openLoan({
    required String borrowAsset,
    required double amount,
    required int durationDays,
    String collateralAsset = 'WAKATI',
  }) async {
    if (amount <= 0) {
      throw StakeLoanException('Montant invalide', errorCode: 'INVALID_AMOUNT');
    }
    try {
      final response = await _supabase
          .rpc(
            'fn_open_stake_loan',
            params: {
              'p_borrow_asset': borrowAsset,
              'p_borrow_amount': amount,
              'p_duration_days': durationDays,
              'p_collateral_asset': collateralAsset,
            },
          )
          .timeout(_rpcTimeout);
      return StakeLoanActionResult.fromJson(_asMap(response));
    } catch (e, st) {
      _errorHandler.handle(e, st, 'StakeLoanService.openLoan');
      rethrow;
    }
  }

  Future<StakeLoanActionResult> repay({
    required String loanId,
    required double amount,
  }) async {
    if (amount <= 0) {
      throw StakeLoanException('Montant invalide', errorCode: 'INVALID_AMOUNT');
    }
    try {
      final response = await _supabase
          .rpc(
            'fn_repay_loan',
            params: {'p_loan_id': loanId, 'p_repay_amount': amount},
          )
          .timeout(_rpcTimeout);
      return StakeLoanActionResult.fromJson(_asMap(response));
    } catch (e, st) {
      _errorHandler.handle(e, st, 'StakeLoanService.repay');
      rethrow;
    }
  }

  /// [preview] = true : calcule les frais et la nouvelle échéance sans rien débiter.
  Future<StakeLoanActionResult> extend({
    required String loanId,
    bool preview = false,
  }) async {
    try {
      final response = await _supabase
          .rpc(
            'fn_extend_stake_loan',
            params: {'p_loan_id': loanId, 'p_preview': preview},
          )
          .timeout(_rpcTimeout);
      return StakeLoanActionResult.fromJson(_asMap(response));
    } catch (e, st) {
      _errorHandler.handle(e, st, 'StakeLoanService.extend');
      rethrow;
    }
  }
}
