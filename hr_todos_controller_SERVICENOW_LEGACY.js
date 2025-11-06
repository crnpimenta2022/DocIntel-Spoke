/**
 * HR Todos Summary Widget - Client Controller
 * VERSÃO COMPATÍVEL COM SERVICENOW LEGACY
 *
 * Esta versão usa APENAS APIs antigas garantidas de funcionar
 * Sem .finally(), sem $q.race(), sem ES6
 */

function HRTodosSummaryController($scope, $window, $timeout, $interval, spUtil) {
    'use strict';

    var ctrl = this;

    /* ==================== CONSTANTS ==================== */

    var CONSTANTS = {
        RESIZE_DELAY: 200,
        REFRESH_INTERVAL: 30000,
        ANIMATION_DELAY: 100,
        SEARCH_DEBOUNCE: 300,
        PAGE_SIZE: 10,
        MOBILE_BREAKPOINT: 768,
        MAX_PAGE_BUTTONS: 7,
        MAX_SEARCH_LENGTH: 100,
        MIN_PAGE: 1
    };

    /* ==================== STATE ==================== */

    ctrl.state = {
        loading: true,
        error: null,
        currentTab: 'pending',
        searchQuery: '',
        selectedFilters: {},
        todos: [],
        pagination: {
            page: 1,
            pageSize: CONSTANTS.PAGE_SIZE,
            totalCount: 0,
            totalPages: 0
        }
    };

    ctrl.tabs = [];
    ctrl.options = {};
    ctrl.isCompactView = false;

    /* ==================== PRIVATE VARIABLES ==================== */

    var timers = {
        resize: null,
        refresh: null,
        animation: null,
        debounce: []
    };

    var eventListeners = [];
    var activeRequests = {};
    var currentLoadRequest = null;
    var requestCounter = 0;
    var cachedPageNumbers = [];
    var lastPaginationHash = null;

    /* ==================== LIFECYCLE HOOKS ==================== */

    ctrl.$onInit = function() {
        try {
            initializeOptions();
            initializeTabs();
            setupEventListeners();
            detectViewportSize();
            startAutoRefresh();
            ctrl.loadTodos();
        } catch (error) {
            handleError('Initialization failed', error, 'Failed to initialize widget');
        }
    };

    ctrl.$onDestroy = function() {
        cleanup();
    };

    /* ==================== PUBLIC API ==================== */

    ctrl.loadTodos = function() {
        ctrl.state.loading = true;
        ctrl.state.error = null;

        var requestId = ++requestCounter;
        var params = {
            tab: ctrl.state.currentTab,
            page: ctrl.state.pagination.page,
            pageSize: CONSTANTS.PAGE_SIZE,
            search: sanitizeSearchInput(ctrl.state.searchQuery),
            filters: sanitizeFilters(ctrl.state.selectedFilters)
        };

        currentLoadRequest = ctrl.server.get({
            action: 'getTodos',
            params: params
        });

        currentLoadRequest.then(
            function(response) {
                if (requestId !== requestCounter) {
                    return;
                }
                handleTodosResponse(response.data);
                ctrl.state.loading = false;
            },
            function(error) {
                if (requestId !== requestCounter) {
                    return;
                }
                handleError('Load todos failed', error, 'Failed to load todos');
                ctrl.state.loading = false;
            }
        );
    };

    ctrl.switchTab = function(tabId) {
        if (!tabId || ctrl.state.currentTab === tabId) {
            return;
        }

        var tabExists = false;
        for (var i = 0; i < ctrl.tabs.length; i++) {
            if (ctrl.tabs[i].id === tabId) {
                tabExists = true;
                break;
            }
        }

        if (!tabExists) {
            console.warn('Invalid tab ID:', tabId);
            return;
        }

        ctrl.state.currentTab = tabId;
        ctrl.state.pagination.page = 1;
        ctrl.state.searchQuery = '';
        ctrl.state.selectedFilters = {};
        ctrl.loadTodos();
    };

    ctrl.onSearch = createDebounce(function(query) {
        ctrl.state.searchQuery = query;
        ctrl.state.pagination.page = 1;
        ctrl.loadTodos();
    }, CONSTANTS.SEARCH_DEBOUNCE);

    ctrl.applyFilters = function(filters) {
        if (!filters || typeof filters !== 'object') {
            return;
        }
        ctrl.state.selectedFilters = sanitizeFilters(filters);
        ctrl.state.pagination.page = 1;
        ctrl.loadTodos();
    };

    ctrl.clearFilters = function() {
        ctrl.state.selectedFilters = {};
        ctrl.state.searchQuery = '';
        ctrl.state.pagination.page = 1;
        ctrl.loadTodos();
    };

    ctrl.goToPage = function(page) {
        page = parseInt(page, 10);

        if (isNaN(page) || page < CONSTANTS.MIN_PAGE || page > ctrl.state.pagination.totalPages) {
            return;
        }

        if (page === ctrl.state.pagination.page) {
            return;
        }

        ctrl.state.pagination.page = page;
        ctrl.loadTodos();
    };

    ctrl.nextPage = function() {
        if (ctrl.state.pagination.page < ctrl.state.pagination.totalPages) {
            ctrl.goToPage(ctrl.state.pagination.page + 1);
        }
    };

    ctrl.previousPage = function() {
        if (ctrl.state.pagination.page > 1) {
            ctrl.goToPage(ctrl.state.pagination.page - 1);
        }
    };

    ctrl.refresh = function(silent) {
        if (!silent) {
            ctrl.state.loading = true;
        }
        ctrl.loadTodos();
    };

    ctrl.performAction = function(todo, action) {
        if (!todo || !todo.sysId || !action) {
            spUtil.addErrorMessage('Invalid action parameters');
            return;
        }

        action = sanitizeActionType(action);
        if (!action) {
            spUtil.addErrorMessage('Invalid action type');
            return;
        }

        var requestKey = todo.sysId + ':' + action;
        if (activeRequests[requestKey]) {
            return;
        }

        executeAction(todo, action, requestKey);
    };

    ctrl.viewTodoDetails = function(todo) {
        if (!todo || !todo.table || !todo.documentId) {
            spUtil.addErrorMessage('Cannot open todo details');
            return;
        }

        try {
            spUtil.openRecord({
                table: todo.table,
                sys_id: todo.documentId
            });
        } catch (error) {
            handleError('View details failed', error, 'Failed to open todo details');
        }
    };

    ctrl.hasActiveFilters = function() {
        return !!(ctrl.state.searchQuery || Object.keys(ctrl.state.selectedFilters).length > 0);
    };

    ctrl.getPageNumbers = function() {
        var currentHash = getPaginationHash();

        if (currentHash === lastPaginationHash) {
            return cachedPageNumbers;
        }

        lastPaginationHash = currentHash;
        cachedPageNumbers = computePageNumbers();

        return cachedPageNumbers;
    };

    ctrl.isActiveTab = function(tabId) {
        return ctrl.state.currentTab === tabId;
    };

    /* ==================== INITIALIZATION ==================== */

    function initializeOptions() {
        ctrl.options = angular.extend({
            showFilters: true,
            showSearch: true,
            enableAutoRefresh: true,
            compactView: false,
            defaultTab: 'pending',
            labels: {}
        }, ctrl.options || {});

        ctrl.state.currentTab = ctrl.options.defaultTab;
    }

    function initializeTabs() {
        var labels = ctrl.options.labels || {};

        ctrl.tabs = [
            { id: 'pending', label: labels.pending || 'Pending', icon: 'clock-o' },
            { id: 'completed', label: labels.completed || 'Completed', icon: 'check' },
            { id: 'closed', label: labels.closed || 'Closed', icon: 'times' }
        ];
    }

    function setupEventListeners() {
        var resizeHandler = createDebounce(function() {
            $scope.$applyAsync(function() {
                detectViewportSize();
            });
        }, CONSTANTS.RESIZE_DELAY);

        $window.addEventListener('resize', resizeHandler);
        eventListeners.push({
            element: $window,
            event: 'resize',
            handler: resizeHandler
        });

        var visibilityHandler = function() {
            if (!document.hidden && ctrl.options.enableAutoRefresh) {
                ctrl.refresh(true);
            }
        };

        document.addEventListener('visibilitychange', visibilityHandler);
        eventListeners.push({
            element: document,
            event: 'visibilitychange',
            handler: visibilityHandler
        });

        var unregisterRefresh = $scope.$on('hr.todos.refresh', function() {
            ctrl.refresh();
        });
        eventListeners.push({ unregister: unregisterRefresh });

        var unregisterUpdate = $scope.$on('hr.todos.updated', function(event, data) {
            handleTodoUpdate(data);
        });
        eventListeners.push({ unregister: unregisterUpdate });
    }

    function startAutoRefresh() {
        if (!ctrl.options.enableAutoRefresh) {
            return;
        }

        timers.refresh = $interval(function() {
            if (document.hidden) {
                return;
            }
            if (!isWidgetVisible()) {
                return;
            }
            ctrl.refresh(true);
        }, CONSTANTS.REFRESH_INTERVAL);
    }

    function detectViewportSize() {
        ctrl.isCompactView = $window.innerWidth < CONSTANTS.MOBILE_BREAKPOINT;
    }

    /* ==================== REQUEST HANDLING ==================== */

    function handleTodosResponse(data) {
        if (!data || typeof data !== 'object') {
            handleError('Invalid response', null, 'Invalid server response');
            return;
        }

        if (!data.success && data.error) {
            handleError('Server error', null, data.message || 'Server returned an error');
            return;
        }

        if (!Array.isArray(data.records)) {
            handleError('Invalid records', null, 'Invalid data format');
            return;
        }

        ctrl.state.todos = [];
        for (var i = 0; i < data.records.length; i++) {
            var todo = validateTodo(data.records[i]);
            if (todo) {
                ctrl.state.todos.push(todo);
            }
        }

        ctrl.state.pagination = {
            page: parseInt(data.page, 10) || 1,
            pageSize: CONSTANTS.PAGE_SIZE,
            totalCount: parseInt(data.totalCount, 10) || 0,
            totalPages: Math.max(0, Math.ceil((parseInt(data.totalCount, 10) || 0) / CONSTANTS.PAGE_SIZE))
        };

        if (timers.animation) {
            $timeout.cancel(timers.animation);
        }

        timers.animation = $timeout(function() {
            for (var i = 0; i < ctrl.state.todos.length; i++) {
                ctrl.state.todos[i].animated = true;
            }
        }, CONSTANTS.ANIMATION_DELAY);
    }

    function validateTodo(todo) {
        if (!todo || typeof todo !== 'object') {
            return null;
        }
        if (!todo.sysId || !todo.table) {
            console.warn('Invalid todo object:', todo);
            return null;
        }
        return todo;
    }

    function handleTodoUpdate(data) {
        if (!data || !data.todoId) {
            return;
        }

        var todo = null;
        for (var i = 0; i < ctrl.state.todos.length; i++) {
            if (ctrl.state.todos[i].sysId === data.todoId) {
                todo = ctrl.state.todos[i];
                break;
            }
        }

        if (todo) {
            if (data.action === 'updated') {
                ctrl.refresh(true);
            } else if (data.action === 'removed') {
                removeTodoFromList(data.todoId);
            }
        }
    }

    function executeAction(todo, action, requestKey) {
        activeRequests[requestKey] = true;
        var originalState = angular.copy(todo);
        todo.isProcessing = true;
        todo.state = getOptimisticState(action);

        ctrl.server.update({
            action: 'performTodoAction',
            todoId: todo.sysId,
            actionType: action
        }).then(
            function(response) {
                delete activeRequests[requestKey];

                if (response.data && response.data.success) {
                    spUtil.addInfoMessage(response.data.message || 'Action completed successfully');
                    removeTodoFromList(todo.sysId);
                } else {
                    angular.extend(todo, originalState);
                    spUtil.addErrorMessage(response.data.message || 'Action failed');
                    todo.isProcessing = false;
                }
            },
            function(error) {
                delete activeRequests[requestKey];
                angular.extend(todo, originalState);
                handleError('Action failed', error, 'Failed to perform action');
                todo.isProcessing = false;
            }
        );
    }

    function getOptimisticState(action) {
        var stateMap = {
            approve: 'approved',
            reject: 'rejected',
            complete: 'completed',
            cancel: 'cancelled'
        };
        return stateMap[action] || 'processing';
    }

    function removeTodoFromList(todoId) {
        var index = -1;
        for (var i = 0; i < ctrl.state.todos.length; i++) {
            if (ctrl.state.todos[i].sysId === todoId) {
                index = i;
                break;
            }
        }

        if (index !== -1) {
            ctrl.state.todos.splice(index, 1);
            ctrl.state.pagination.totalCount--;

            if (ctrl.state.todos.length === 0 && ctrl.state.pagination.page > 1) {
                ctrl.state.pagination.page--;
                ctrl.loadTodos();
            }
        }
    }

    /* ==================== PAGINATION ==================== */

    function computePageNumbers() {
        var pages = [];
        var current = ctrl.state.pagination.page;
        var total = ctrl.state.pagination.totalPages;

        if (total === 0) {
            return pages;
        }

        if (total <= CONSTANTS.MAX_PAGE_BUTTONS) {
            for (var i = 1; i <= total; i++) {
                pages.push(i);
            }
        } else {
            pages.push(1);

            if (current > 3) {
                pages.push('...');
            }

            var start = Math.max(2, current - 1);
            var end = Math.min(current + 1, total - 1);

            for (var j = start; j <= end; j++) {
                pages.push(j);
            }

            if (current < total - 2) {
                pages.push('...');
            }

            pages.push(total);
        }

        return pages;
    }

    function getPaginationHash() {
        return ctrl.state.pagination.page + '|' + ctrl.state.pagination.totalPages;
    }

    /* ==================== VALIDATION ==================== */

    function sanitizeSearchInput(input) {
        if (!input || typeof input !== 'string') {
            return '';
        }
        return input
            .replace(/<script[^>]*>.*?<\/script>/gi, '')
            .replace(/[<>]/g, '')
            .substring(0, CONSTANTS.MAX_SEARCH_LENGTH)
            .trim();
    }

    function sanitizeFilters(filters) {
        var safe = {};
        var allowedKeys = ['priority', 'type', 'assignmentGroup', 'state'];

        if (!filters || typeof filters !== 'object') {
            return safe;
        }

        for (var i = 0; i < allowedKeys.length; i++) {
            var key = allowedKeys[i];
            if (filters[key]) {
                if (Array.isArray(filters[key])) {
                    safe[key] = [];
                    for (var j = 0; j < filters[key].length; j++) {
                        var sanitized = sanitizeString(filters[key][j]);
                        if (sanitized) {
                            safe[key].push(sanitized);
                        }
                    }
                } else if (typeof filters[key] === 'string') {
                    var sanitized = sanitizeString(filters[key]);
                    if (sanitized) {
                        safe[key] = [sanitized];
                    }
                }
            }
        }

        return safe;
    }

    function sanitizeString(str) {
        if (!str) {
            return '';
        }
        if (typeof str !== 'string') {
            str = String(str);
        }
        return str.replace(/[<>]/g, '').substring(0, 255).trim();
    }

    function sanitizeActionType(action) {
        if (!action || typeof action !== 'string') {
            return null;
        }
        var allowed = ['approve', 'reject', 'delegate', 'reassign', 'cancel', 'complete'];
        action = action.toLowerCase().trim();

        for (var i = 0; i < allowed.length; i++) {
            if (allowed[i] === action) {
                return action;
            }
        }
        return null;
    }

    /* ==================== UTILITY ==================== */

    function createDebounce(func, wait) {
        var timeout;
        return function() {
            var context = this;
            var args = arguments;

            if (timeout) {
                $timeout.cancel(timeout);
                var index = -1;
                for (var i = 0; i < timers.debounce.length; i++) {
                    if (timers.debounce[i] === timeout) {
                        index = i;
                        break;
                    }
                }
                if (index !== -1) {
                    timers.debounce.splice(index, 1);
                }
            }

            timeout = $timeout(function() {
                func.apply(context, args);
                var idx = -1;
                for (var i = 0; i < timers.debounce.length; i++) {
                    if (timers.debounce[i] === timeout) {
                        idx = i;
                        break;
                    }
                }
                if (idx !== -1) {
                    timers.debounce.splice(idx, 1);
                }
            }, wait);

            timers.debounce.push(timeout);
        };
    }

    function isWidgetVisible() {
        try {
            var element = document.querySelector('.todos-widget');
            if (!element) {
                return false;
            }
            var rect = element.getBoundingClientRect();
            return (
                rect.top < $window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < $window.innerWidth &&
                rect.right > 0
            );
        } catch (error) {
            return true;
        }
    }

    function handleError(context, error, userMessage) {
        console.error('[HR Todos]', context, error);
        ctrl.state.error = userMessage || 'An error occurred';
        spUtil.addErrorMessage(userMessage || 'An error occurred');
    }

    /**
     * CRITICAL FIX: cleanup() dentro do controller
     */
    function cleanup() {
        if (timers.resize) {
            $timeout.cancel(timers.resize);
        }
        if (timers.refresh) {
            $interval.cancel(timers.refresh);
        }
        if (timers.animation) {
            $timeout.cancel(timers.animation);
        }

        for (var i = 0; i < timers.debounce.length; i++) {
            $timeout.cancel(timers.debounce[i]);
        }

        for (var i = 0; i < eventListeners.length; i++) {
            var listener = eventListeners[i];
            if (listener.unregister && typeof listener.unregister === 'function') {
                listener.unregister();
            } else if (listener.element && listener.event && listener.handler) {
                listener.element.removeEventListener(listener.event, listener.handler);
            }
        }

        timers.debounce = [];
        eventListeners = [];
        activeRequests = {};
        cachedPageNumbers = [];
        lastPaginationHash = null;
    }
}
