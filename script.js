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
        faqItems.forEach(otherItem => {
            if (otherItem !== item && otherItem.classList.contains('active')) {
                otherItem.classList.remove('active');
            }
        });

        item.classList.toggle('active');
    });
});

// ===========================
// MOBILE PRICING CARD SLIDER
// ===========================
class PricingSlider {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.currentIndex = 0;
        this.startX = 0;
        this.currentX = 0;
        this.isDragging = false;
        this.sliderWrapper = null;
        this.sliderContainer = null;
        this.sliderTrack = null;
        this.dots = [];

        this.init();
    }

    init() {
        if (window.innerWidth > 768) return; // Only init on mobile

        const cards = this.container.querySelectorAll('.pricing-card');
        if (cards.length === 0) return;

        // Skip slider if only 1 card (e.g., All Markets)
        if (cards.length === 1) {
            console.log(`Skipping slider for ${this.container.id} - only 1 card`);
            return;
        }

        // Create slider structure
        this.createSliderStructure(cards);

        // Add touch/mouse events
        this.addEventListeners();

        // Create dots
        this.createDots(cards.length);

        // Create arrows
        this.createArrows();

        // Initial update
        this.updateSlider();
    }

    createSliderStructure(cards) {
        // Create wrapper
        this.sliderWrapper = document.createElement('div');
        this.sliderWrapper.className = 'pricing-slider-wrapper';

        // Create container
        this.sliderContainer = document.createElement('div');
        this.sliderContainer.className = 'pricing-slider-container';

        // Create track
        this.sliderTrack = document.createElement('div');
        this.sliderTrack.className = 'pricing-slider-track';

        // Move cards into slider
        cards.forEach(card => {
            const slide = document.createElement('div');
            slide.className = 'pricing-card-slide';
            slide.appendChild(card.cloneNode(true));
            this.sliderTrack.appendChild(slide);
        });

        // Assemble structure
        this.sliderContainer.appendChild(this.sliderTrack);
        this.sliderWrapper.appendChild(this.sliderContainer);

        // Replace original content
        this.container.innerHTML = '';
        this.container.appendChild(this.sliderWrapper);
    }

    createDots(count) {
        const dotsContainer = document.createElement('div');
        dotsContainer.className = 'slider-dots';

        for (let i = 0; i < count; i++) {
            const dot = document.createElement('div');
            dot.className = 'slider-dot';
            if (i === 0) dot.classList.add('active');

            dot.addEventListener('click', () => {
                this.goToSlide(i);
            });

            this.dots.push(dot);
            dotsContainer.appendChild(dot);
        }

        this.sliderWrapper.appendChild(dotsContainer);
    }

    createArrows() {
        // Left arrow
        const leftArrow = document.createElement('div');
        leftArrow.className = 'slider-arrow slider-arrow-left disabled';
        leftArrow.innerHTML = '<i class="fas fa-chevron-left"></i>';
        leftArrow.addEventListener('click', () => this.prev());

        // Right arrow
        const rightArrow = document.createElement('div');
        rightArrow.className = 'slider-arrow slider-arrow-right';
        rightArrow.innerHTML = '<i class="fas fa-chevron-right"></i>';
        rightArrow.addEventListener('click', () => this.next());

        this.sliderWrapper.appendChild(leftArrow);
        this.sliderWrapper.appendChild(rightArrow);

        this.leftArrow = leftArrow;
        this.rightArrow = rightArrow;
    }

    addEventListeners() {
        // Touch events
        this.sliderTrack.addEventListener('touchstart', (e) => this.handleStart(e), { passive: true });
        this.sliderTrack.addEventListener('touchmove', (e) => this.handleMove(e), { passive: true });
        this.sliderTrack.addEventListener('touchend', () => this.handleEnd());

        // Mouse events for testing on desktop
        this.sliderTrack.addEventListener('mousedown', (e) => this.handleStart(e));
        this.sliderTrack.addEventListener('mousemove', (e) => this.handleMove(e));
        this.sliderTrack.addEventListener('mouseup', () => this.handleEnd());
        this.sliderTrack.addEventListener('mouseleave', () => this.handleEnd());
    }

    handleStart(e) {
        this.isDragging = true;
        this.startX = e.type.includes('mouse') ? e.pageX : e.touches[0].pageX;
        this.sliderTrack.classList.add('no-transition');
    }

    handleMove(e) {
        if (!this.isDragging) return;

        this.currentX = e.type.includes('mouse') ? e.pageX : e.touches[0].pageX;
        const diff = this.currentX - this.startX;

        // Add drag effect
        const currentTranslate = -this.currentIndex * (85 + 1.5); // 85% + gap
        const dragPercent = (diff / window.innerWidth) * 100;
        this.sliderTrack.style.transform = `translateX(${currentTranslate + dragPercent}%)`;
    }

    handleEnd() {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.sliderTrack.classList.remove('no-transition');

        const diff = this.currentX - this.startX;
        const threshold = 50; // px

        if (Math.abs(diff) > threshold) {
            if (diff > 0) {
                this.prev();
            } else {
                this.next();
            }
        } else {
            this.updateSlider();
        }

        this.startX = 0;
        this.currentX = 0;
    }

    prev() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updateSlider();
        }
    }

    next() {
        const slides = this.sliderTrack.querySelectorAll('.pricing-card-slide');
        if (this.currentIndex < slides.length - 1) {
            this.currentIndex++;
            this.updateSlider();
        }
    }

    goToSlide(index) {
        this.currentIndex = index;
        this.updateSlider();
    }

    updateSlider() {
        // Update transform
        const offset = -this.currentIndex * (85 + 1.5); // 85% width + 1.5% gap
        this.sliderTrack.style.transform = `translateX(${offset}%)`;

        // Update dots
        this.dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === this.currentIndex);
        });

        // Update arrows
        const slides = this.sliderTrack.querySelectorAll('.pricing-card-slide');
        this.leftArrow.classList.toggle('disabled', this.currentIndex === 0);
        this.rightArrow.classList.toggle('disabled', this.currentIndex === slides.length - 1);
    }
}

// Initialize sliders for each pricing category
let currentSliders = {};

function initPricingSliders() {
    if (window.innerWidth <= 768) {
        // Only initialize slider for the currently active tab
        const activeCategory = document.querySelector('.plan-category.active');
        if (activeCategory) {
            const categoryId = activeCategory.id;
            console.log(`Initializing slider for active category: ${categoryId}`);

            const categoryKey = categoryId.replace('-plans', ''); // e.g., 'single-plans' -> 'single'
            currentSliders[categoryKey] = new PricingSlider(categoryId);
        }
    }
}

// ===========================
// Pricing Tab Switcher
// ===========================
const tabBtns = document.querySelectorAll('.tab-btn');
const planCategories = document.querySelectorAll('.plan-category');

tabBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        planCategories.forEach(c => c.classList.remove('active'));

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

            // Reinitialize slider for the newly active category on mobile
            if (window.innerWidth <= 768) {
                setTimeout(() => {
                    currentSliders[category] = new PricingSlider(categoryMap[category]);
                }, 100);
            }
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

    // Initialize pricing sliders on mobile
    initPricingSliders();

    // Reinitialize on window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            // Reload sliders if switching between mobile/desktop
            if (window.innerWidth <= 768 && Object.keys(currentSliders).length === 0) {
                initPricingSliders();
            } else if (window.innerWidth > 768 && Object.keys(currentSliders).length > 0) {
                // Reset to original grid layout
                window.location.reload();
            }
        }, 250);
    });

    // Protect external links
    document.querySelectorAll('a[href^="http"]').forEach(link => {
        if (link.getAttribute('href').startsWith('#')) return;

        link.addEventListener('click', () => {
            if (navMenu && navMenu.classList.contains('active')) {
                navMenu.classList.remove('active');
                if (mobileToggle) mobileToggle.classList.remove('active');
            }
        });
    });

    // Track page views
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

const debouncedScroll = debounce(() => {
    // Additional scroll logic can be added here if needed
}, 100);

window.addEventListener('scroll', debouncedScroll, { passive: true });

// ===========================
// Disclaimer Modal
// ===========================
const modal = document.getElementById('disclaimerModal');
const agreeCheckbox = document.getElementById('agreeCheckbox');
const proceedBtn = document.getElementById('proceedBtn');
const cancelBtn = document.getElementById('cancelBtn');
const viewFullTerms = document.getElementById('viewFullTerms');

let pendingUrl = null;

// Intercept all Subscribe Now / payment buttons
document.querySelectorAll('a[href^="https://buy.stripe.com"]').forEach(link => {
    link.addEventListener('click', function (e) {
        e.preventDefault();
        pendingUrl = this.href;
        agreeCheckbox.checked = false;
        proceedBtn.disabled = true;
        modal.style.display = 'flex';
    });
});

// Enable Proceed button only when checkbox is ticked
agreeCheckbox.addEventListener('change', () => {
    proceedBtn.disabled = !agreeCheckbox.checked;
});

// Proceed to Stripe
proceedBtn.addEventListener('click', () => {
    if (pendingUrl && agreeCheckbox.checked) {
        modal.style.display = 'none';
        window.open(pendingUrl, '_blank', 'noopener,noreferrer');
        pendingUrl = null;
    }
});

// Cancel
cancelBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    pendingUrl = null;
});

// Close on backdrop click
modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.style.display = 'none';
        pendingUrl = null;
    }
});

// View full terms link
if (viewFullTerms) {
    viewFullTerms.addEventListener('click', (e) => {
        e.preventDefault();
        window.open('terms.html', '_blank');
    });
}