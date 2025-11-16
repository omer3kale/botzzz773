(function () {
    // Adjust these selectors to match your HTML
    const openSelector = '.js-open-delete-provider';      // the top-right "Delete" button that opens confirm
    const confirmSelector = '.js-confirm-delete-provider';// the confirm button in the modal
    const providerCardSelector = '.provider-card';        // wrapper element for the provider UI
    const apiBase = '/api/providers';                     // change to your real API path

    // store current provider id for modal
    let currentProviderId = null;

    document.addEventListener('click', (e) => {
        const openBtn = e.target.closest(openSelector);
        if (openBtn) {
            e.preventDefault();
            currentProviderId = openBtn.getAttribute('data-provider-id');
            // show your confirm modal here (toggle class, bootstrap modal, etc.)
            // Example for bootstrap modal: $('#deleteProviderModal').modal('show')
            const modal = document.querySelector('#deleteProviderModal');
            if (modal) modal.classList.add('is-active'); // adjust to your modal implementation
            return;
        }

        const confirmBtn = e.target.closest(confirmSelector);
        if (confirmBtn) {
            e.preventDefault();
            if (!currentProviderId) return console.error('No provider id to delete');

            // disable to prevent double clicks
            confirmBtn.disabled = true;
            const originalText = confirmBtn.textContent;
            confirmBtn.textContent = 'Deleting...';

            // CSRF token support (meta or hidden input)
            const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
                      || document.querySelector('input[name="_csrf"]')?.value;

            fetch(`${apiBase}/${encodeURIComponent(currentProviderId)}`, {
                method: 'DELETE',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...(csrf ? { 'X-CSRF-Token': csrf } : {})
                },
                credentials: 'include'
            })
            .then(async res => {
                if (!res.ok) {
                    const body = await res.text().catch(()=>res.statusText);
                    throw new Error(`${res.status} ${body}`);
                }
                return res.json().catch(()=>({}));
            })
            .then(() => {
                // close modal
                const modal = document.querySelector('#deleteProviderModal');
                if (modal) modal.classList.remove('is-active');

                // remove provider card from DOM
                const card = document.querySelector(`${providerCardSelector}[data-id="${currentProviderId}"]`);
                if (card) card.remove();

                currentProviderId = null;
            })
            .catch(err => {
                console.error('Delete provider failed:', err);
                alert('Failed to delete provider. Check console for details.');
            })
            .finally(() => {
                confirmBtn.disabled = false;
                confirmBtn.textContent = originalText;
            });
        }
    });
})();