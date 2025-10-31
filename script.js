// ===========================
// Initialize AOS Animation
// ===========================
AOS.init({
    duration: 1000,
    once: true,
    offset: 100
});

// ===========================
// Mobile Navigation Toggle
// ===========================
const mobileToggle = document.querySelector('.mobile-toggle');
const navMenu = document.querySelector('.nav-menu');

if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
        navMenu.classList.toggle('active');
        mobileToggle.classList.toggle('active');
    });
}

// Mobile menu styles
const mobileStyles = `
    @media (max-width: 768px) {
        .nav-menu {
            position: fixed;
            top: 70px;
            right: -100%;
            width: 100%;
            height: calc(100vh - 70px);
            background: white;
            flex-direction: column;
            padding: 2rem;
            transition: right 0.3s ease;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        
        .nav-menu.active {
            right: 0;
        }
        
        .mobile-toggle.active span:nth-child(1) {
            transform: rotate(45deg) translate(5px, 5px);
        }
        
        .mobile-toggle.active span:nth-child(2) {
            opacity: 0;
        }
        
        .mobile-toggle.active span:nth-child(3) {
            transform: rotate(-45deg) translate(7px, -6px);
        }
    }
`;

const styleSheet = document.createElement("style");
styleSheet.textContent = mobileStyles;
document.head.appendChild(styleSheet);

// ===========================
// Smooth Scrolling
// ===========================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const offset = 80;
            const targetPosition = target.offsetTop - offset;

            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });

            // Close mobile menu if open
            navMenu.classList.remove('active');
            mobileToggle.classList.remove('active');
        }
    });
});

// ===========================
// Navbar Scroll Effect
// ===========================
const navbar = document.querySelector('.navbar');
let lastScroll = 0;

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
        navbar.style.background = 'rgba(255, 255, 255, 0.98)';
        navbar.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    } else {
        navbar.style.background = 'rgba(255, 255, 255, 0.95)';
        navbar.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    }

    lastScroll = currentScroll;
});

// ===========================
// Active Navigation Link
// ===========================
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-link');

window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;

        if (window.pageYOffset >= sectionTop - 200) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href').slice(1) === current) {
            link.classList.add('active');
        }
    });
});

// ===========================
// FAQ Accordion
// ===========================
const faqItems = document.querySelectorAll('.faq-item');

faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');

    question.addEventListener('click', () => {
        // Close other items
        faqItems.forEach(otherItem => {
            if (otherItem !== item && otherItem.classList.contains('active')) {
                otherItem.classList.remove('active');
            }
        });

        // Toggle current item
        item.classList.toggle('active');
    });
});

// ===========================
// Pricing Tab Switcher
// ===========================
const tabBtns = document.querySelectorAll('.tab-btn');
const planCategories = document.querySelectorAll('.plan-category');

tabBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => {
        // Remove active class from all buttons and categories
        tabBtns.forEach(b => b.classList.remove('active'));
        planCategories.forEach(c => c.classList.remove('active'));

        // Add active class to clicked button and corresponding category
        btn.classList.add('active');

        const categoryMap = {
            'single': 'single-plans',
            'combo': 'combo-plans',
            'all': 'all-plans'
        };

        const category = btn.getAttribute('data-category');
        const targetCategory = document.getElementById(categoryMap[category]);
        if (targetCategory) {
            targetCategory.classList.add('active');
        }
    });
});

// ===========================
// Scroll to Top Button
// ===========================
const scrollTopBtn = document.createElement('div');
scrollTopBtn.className = 'scroll-top';
scrollTopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
document.body.appendChild(scrollTopBtn);

window.addEventListener('scroll', () => {
    if (window.pageYOffset > 500) {
        scrollTopBtn.classList.add('show');
    } else {
        scrollTopBtn.classList.remove('show');
    }
});

scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
});

// ===========================
// Parallax Effect for Hero
// ===========================
window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const parallaxElements = document.querySelectorAll('.circle-animation, .radar-animation');

    parallaxElements.forEach(element => {
        const speed = element.classList.contains('circle-animation') ? 0.5 : 0.3;
        element.style.transform = `translateY(${scrolled * speed}px)`;
    });
});

// ===========================
// Pricing Card Hover Effects
// ===========================
const pricingCards = document.querySelectorAll('.pricing-card');

pricingCards.forEach(card => {
    card.addEventListener('mouseenter', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
    });
});

// ===========================
// Initialize Everything on DOM Ready
// ===========================
document.addEventListener('DOMContentLoaded', () => {
    console.log('RHO Market Navigator website loaded successfully!');

    // Track page views (replace with your analytics if needed)
    if (typeof gtag !== 'undefined') {
        gtag('event', 'page_view', {
            page_title: document.title,
            page_location: window.location.href,
            page_path: window.location.pathname
        });
    }
});

// ===========================
// Performance Optimization
// ===========================
// Debounce function for scroll events
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Apply debounce to scroll events for better performance
const debouncedScroll = debounce(() => {
    // Additional scroll logic can be added here if needed
}, 100);

window.addEventListener('scroll', debouncedScroll, { passive: true });

// ===========================
// Disclaimer Modal for Stripe Payments
// ===========================
const disclaimerModal = document.getElementById('disclaimerModal');
const agreeCheckbox = document.getElementById('agreeCheckbox');
const proceedBtn = document.getElementById('proceedBtn');
const cancelBtn = document.getElementById('cancelBtn');
const viewFullTermsLink = document.getElementById('viewFullTerms');
let currentStripeLink = '';

// Wait for DOM to be ready, then intercept all Subscribe buttons
function initDisclaimerModal() {
    const subscribeButtons = document.querySelectorAll('a[href*="stripe.com"]');

    subscribeButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            currentStripeLink = button.getAttribute('href');
            disclaimerModal.style.display = 'block';
            document.body.style.overflow = 'hidden'; // Prevent background scrolling

            // Reset checkbox and button state
            agreeCheckbox.checked = false;
            proceedBtn.disabled = true;
        });
    });

    console.log(`✅ Disclaimer modal initialized for ${subscribeButtons.length} subscription buttons`);
}

// Enable/disable proceed button based on checkbox
if (agreeCheckbox) {
    agreeCheckbox.addEventListener('change', () => {
        proceedBtn.disabled = !agreeCheckbox.checked;
    });
}

// Cancel button - close modal
if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
        disclaimerModal.style.display = 'none';
        document.body.style.overflow = 'auto'; // Restore scrolling
        currentStripeLink = '';
    });
}

// Proceed to Stripe payment
if (proceedBtn) {
    proceedBtn.addEventListener('click', () => {
        if (agreeCheckbox.checked && currentStripeLink) {
            // Track acceptance timestamp (optional - for your records)
            const acceptanceTime = new Date().toISOString();
            console.log('✅ User accepted terms at:', acceptanceTime);

            // Optional: Store acceptance in localStorage
            localStorage.setItem('rho_terms_accepted', acceptanceTime);

            // Redirect to Stripe
            window.location.href = currentStripeLink;
        }
    });
}

// View full terms link
if (viewFullTermsLink) {
    viewFullTermsLink.addEventListener('click', (e) => {
        e.preventDefault();
        // Open full terms page in new tab
        window.open('terms.html', '_blank');
    });
}

// Close modal when clicking outside the modal content
window.addEventListener('click', (e) => {
    if (e.target === disclaimerModal) {
        disclaimerModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        currentStripeLink = '';
    }
});

// Close modal with ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && disclaimerModal.style.display === 'block') {
        disclaimerModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        currentStripeLink = '';
    }
});

// Initialize modal after DOM is fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDisclaimerModal);
} else {
    initDisclaimerModal();
}