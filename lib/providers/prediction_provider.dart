// lib/providers/prediction_provider.dart
//
// ✅ FIX PRIX BTC :
//   - Le provider charge lui-même le prix BTC via PriceService
//   - Refresh automatique toutes les 15s
//   - 3 niveaux de fallback : PriceService → forceRefresh → asset_prices DB
//   - Plus besoin d'appeler updatePrice() depuis l'extérieur

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as supa;
import 'package:wakati/service/prediction/prediction_service.dart';
import '../../models/prediction_model.dart';
import '../../service/data/price_service.dart';

/// Point de prix horodaté (sert aux graphiques de l'écran).
class PricePoint {
  final DateTime time;
  final double price;
  const PricePoint(this.time, this.price);
}

class PredictionProvider extends ChangeNotifier {
  final PredictionService _service = PredictionService();

  PredictionState? _state;
  bool _isLoading = false;
  bool _isActing = false;
  String? _error;
  BetResult? _lastResult;

  double _currentPrice = 0;
  double _priceChange = 0;
  bool _priceLoading = true;
  bool _priceStale = false;
  DateTime? _lastPriceAt;
  final List<PricePoint> _priceHistory = [];
  bool _fetchingPrice = false;
  int _refreshTick = 0;
  String? _resolvingBetId;

  Timer? _priceTimer;
  Timer? _betTimer;
  int _secondsLeft = 0;

  // ── Getters ──
  PredictionState? get state => _state;
  bool get isLoading => _isLoading;
  bool get isActing => _isActing;
  String? get error => _error;
  BetResult? get lastResult => _lastResult;
  double get currentPrice => _currentPrice;
  double get priceChange => _priceChange;
  bool get priceLoading => _priceLoading;
  bool get priceStale => _priceStale;
  DateTime? get lastPriceAt => _lastPriceAt;
  List<PricePoint> get priceHistory => List.unmodifiable(_priceHistory);
  int get secondsLeft => _secondsLeft;
  PredictionConfig? get config => _state?.config;
  PredictionBet? get activeBet => _state?.activeBet;
  PredictionStats get stats => _state?.stats ?? PredictionStats.empty();
  List<PredictionBet> get history => _state?.history ?? [];
  double get balance => _state?.balance ?? 0;
  int get betsToday => _state?.betsToday ?? 0;
  bool get canBet => _state?.canBet ?? false;
  bool get hasPendingBet => activeBet != null;
  bool get isPriceReady => _currentPrice > 0;

  // ──────────────────────────────────────
  // INITIALISATION
  // ──────────────────────────────────────

  Future<void> initialize() async {
    // Prix + état du jeu en parallèle
    await Future.wait([loadState(), _fetchBtcPrice()]);
    _startPriceRefresh();
  }

  Future<void> loadState({bool silent = false}) async {
    if (!silent) _setLoading(true);
    _clearError();
    try {
      _state = await _service.getState();
      if (_state?.activeBet != null && _state!.activeBet!.isPending) {
        _startBetTimer(_state!.activeBet!);
      }
    } catch (e) {
      _error = _friendly(e);
    } finally {
      if (!silent) _setLoading(false);
      notifyListeners();
    }
  }

  // ──────────────────────────────────────
  // PRIX BTC
  // ──────────────────────────────────────

  /// Applique un nouveau prix et l'ajoute à l'historique (max 240 points).
  void _applyPrice(double price, double change, {bool stale = false}) {
    _currentPrice = price;
    _priceChange = change;
    _priceLoading = false;
    _priceStale = stale;
    final now = DateTime.now();
    _lastPriceAt = now;
    _priceHistory.add(PricePoint(now, price));
    if (_priceHistory.length > 240) {
      _priceHistory.removeRange(0, _priceHistory.length - 240);
    }
    notifyListeners();
  }

  /// Tentative 1 : PriceService (cache ou réseau)
  Future<void> _fetchBtcPrice() async {
    if (_fetchingPrice) return;
    _fetchingPrice = true;
    try {
      await _fetchBtcPriceInner();
    } finally {
      _fetchingPrice = false;
    }
  }

  Future<void> _fetchBtcPriceInner() async {
    try {
      // PriceService cherche sous 'BTC' ou 'BTCUSDT' selon la config de l'app
      final prices = await PriceService.getRealtimePrices(
        symbols: ['BTC', 'BTCUSDT'],
      );

      final data =
          prices['BTC'] ??
          prices['BTCUSDT'] ??
          prices.values.firstWhere(
            (p) => p.price > 0,
            orElse:
                () => PriceData(
                  price: 0,
                  change24h: 0,
                  source: 'none',
                  lastUpdate: DateTime.now(),
                  priceAgeSeconds: 9999,
                  isStale: true,
                ),
          );

      if (data.price > 0) {
        _applyPrice(data.price, data.change24h, stale: data.isStale);
        return;
      }
    } catch (e) {
      debugPrint('⚠️ Prediction prix - tentative 1 échouée: $e');
    }

    // Tentative 2 : forceRefresh
    await _fetchBtcPriceForced();
  }

  Future<void> _fetchBtcPriceForced() async {
    try {
      final prices = await PriceService.getRealtimePrices(
        symbols: ['BTC', 'BTCUSDT'],
        forceRefresh: true,
      );

      for (final key in ['BTC', 'BTCUSDT']) {
        final data = prices[key];
        if (data != null && data.price > 0) {
          _applyPrice(data.price, data.change24h, stale: data.isStale);
          return;
        }
      }
    } catch (e) {
      debugPrint('⚠️ Prediction prix - tentative 2 échouée: $e');
    }

    // Tentative 3 : lecture directe depuis asset_prices en BDD
    await _fetchBtcPriceFromDb();
  }

  Future<void> _fetchBtcPriceFromDb() async {
    try {
      final client = supa.Supabase.instance.client;
      final resp =
          await client
              .from('asset_prices')
              .select('price_usd, change_24h')
              .or('asset_symbol.eq.BTC,asset_symbol.eq.BTCUSDT')
              .order('updated_at', ascending: false)
              .limit(1)
              .maybeSingle();

      if (resp != null) {
        final price = (resp['price_usd'] as num?)?.toDouble() ?? 0;
        if (price > 0) {
          _applyPrice(
            price,
            (resp['change_24h'] as num?)?.toDouble() ?? 0,
            stale: true,
          );
          return;
        }
      }
    } catch (e) {
      debugPrint('⚠️ Prediction prix - tentative 3 (DB) échouée: $e');
    }
    _priceLoading = false;
    notifyListeners();
  }

  void _startPriceRefresh() {
    _priceTimer?.cancel();
    // Tick toutes les 5 s : prix rafraîchi toutes les 5 s pendant un pari
    // (graphique en direct), sinon toutes les 15 s.
    _priceTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _refreshTick++;
      if (hasPendingBet || _refreshTick % 3 == 0) {
        _fetchBtcPrice();
      }
    });
  }

  // ──────────────────────────────────────
  // PLACER UN PARI
  // ──────────────────────────────────────

  Future<bool> placeBet(String direction) async {
    if (!canBet || _currentPrice == 0) return false;
    _setActing(true);
    _clearError();
    _lastResult = null;
    try {
      final resp = await _service.placeBet(
        direction: direction,
        amount: config!.betAmount,
        priceAtBet: _currentPrice,
      );
      if (resp['success'] != true) {
        _error = resp['error'] as String? ?? 'Erreur inconnue';
        notifyListeners();
        return false;
      }
      await loadState(silent: true);
      if (_state?.activeBet != null) _startBetTimer(_state!.activeBet!);
      return true;
    } catch (e) {
      _error = _friendly(e);
      notifyListeners();
      return false;
    } finally {
      _setActing(false);
    }
  }

  Future<bool> placeBetWithAmount(String direction, double amount) async {
    if (!canBet || _currentPrice == 0) return false;
    _setActing(true);
    _clearError();
    _lastResult = null;
    try {
      final resp = await _service.placeBet(
        direction: direction,
        amount: amount,
        priceAtBet: _currentPrice,
      );
      if (resp['success'] != true) {
        _error = resp['error'] as String?;
        notifyListeners();
        return false;
      }
      await loadState(silent: true);
      if (_state?.activeBet != null) _startBetTimer(_state!.activeBet!);
      return true;
    } catch (e) {
      _error = _friendly(e);
      notifyListeners();
      return false;
    } finally {
      _setActing(false);
    }
  }

  // ──────────────────────────────────────
  // TIMER PARI + RÉSOLUTION
  // ──────────────────────────────────────

  void _startBetTimer(PredictionBet bet) {
    _betTimer?.cancel();
    _secondsLeft = bet.secondsLeft;
    if (_secondsLeft <= 0) {
      _resolveBet(bet);
      return;
    }
    _betTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      _secondsLeft--;
      notifyListeners();
      if (_secondsLeft <= 0) {
        t.cancel();
        _resolveBet(bet);
      }
    });
  }

  Future<void> _resolveBet(PredictionBet bet) async {
    // Évite deux résolutions simultanées du même pari
    if (_resolvingBetId == bet.id) return;
    _resolvingBetId = bet.id;

    try {
      // Rafraîchir le prix juste avant la résolution
      await _fetchBtcPrice();
      if (_currentPrice == 0) {
        _resolvingBetId = null;
        return;
      }

      _setActing(true);
      try {
        final result = await _service.resolveBet(
          betId: bet.id,
          priceAtResolution: _currentPrice,
        );
        if (result.success) {
          _lastResult = result;
          await loadState(silent: true);
        } else {
          // Ex. « timer pas encore écoulé » : on patiente puis on resynchronise
          debugPrint('⚠️ Résolution refusée: ${result.error}');
          await Future.delayed(const Duration(seconds: 3));
          _resolvingBetId = null;
          await loadState(silent: true);
        }
      } catch (_) {
        await Future.delayed(const Duration(seconds: 5));
        _resolvingBetId = null;
        await loadState(silent: true);
      } finally {
        _setActing(false);
      }
    } finally {
      // Libère le verrou si le pari n'est plus en attente
      if (_state?.activeBet?.id != bet.id) _resolvingBetId = null;
    }
  }

  void clearLastResult() {
    _lastResult = null;
    notifyListeners();
  }

  // ──────────────────────────────────────
  // UTILITAIRES
  // ──────────────────────────────────────

  void clearError() {
    _error = null;
    notifyListeners();
  }

  void _setLoading(bool v) {
    _isLoading = v;
    notifyListeners();
  }

  void _setActing(bool v) {
    _isActing = v;
    notifyListeners();
  }

  void _clearError() => _error = null;

  String _friendly(dynamic e) {
    final s = e.toString().toLowerCase();
    if (s.contains('solde') || s.contains('insuffisant'))
      return 'Solde insuffisant';
    if (s.contains('cooldown') || s.contains('attendez')) return e.toString();
    if (s.contains('limite')) return e.toString();
    if (s.contains('timeout') || s.contains('connection'))
      return 'Problème de connexion';
    return 'Une erreur est survenue';
  }

  @override
  void dispose() {
    _priceTimer?.cancel();
    _betTimer?.cancel();
    super.dispose();
  }
}
