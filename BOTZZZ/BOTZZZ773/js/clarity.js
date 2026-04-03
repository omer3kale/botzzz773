(function (windowObject, documentObject) {
    var CLARITY_PROJECT_ID = 'w5wx6g7fli';
    var currentPath = (windowObject.location && windowObject.location.pathname) || '';

    if (!CLARITY_PROJECT_ID || windowObject.clarity || currentPath.indexOf('/admin/') !== -1) {
        return;
    }

    windowObject.clarity = windowObject.clarity || function () {
        (windowObject.clarity.q = windowObject.clarity.q || []).push(arguments);
    };

    var script = documentObject.createElement('script');
    script.async = true;
    script.src = 'https://www.clarity.ms/tag/' + CLARITY_PROJECT_ID;

    var firstScript = documentObject.getElementsByTagName('script')[0];
    if (firstScript && firstScript.parentNode) {
        firstScript.parentNode.insertBefore(script, firstScript);
    } else {
        documentObject.head.appendChild(script);
    }
})(window, document);
