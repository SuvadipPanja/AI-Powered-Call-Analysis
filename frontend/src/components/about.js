/**
 * About — polished product & developer overview with animated sections.
 */
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBrain,
  FaEnvelope,
  FaRobot,
  FaShieldAlt,
  FaChartLine,
  FaMicrophone,
  FaCloudUploadAlt,
  FaCheckDouble,
  FaDatabase,
  FaReact,
  FaNodeJs,
  FaServer,
  FaUsers,
  FaCog,
  FaFileAlt,
  FaTachometerAlt,
  FaKey,
  FaHeadset,
} from "react-icons/fa";
import { PageSection, Card, Button, Badge } from "./ui";
import { APP_VERSION, getAppFooter } from "../utils/appMeta";
import { useAppBranding } from "../utils/appBranding";
import "./about-page.css";

const ROTATING_LINES = [
  "AI-driven insights from every call.",
  "Real-time scoring across 101 languages.",
  "Enterprise security with role-based access.",
  "Transform voice into actionable intelligence.",
];

const STATS = [
  { icon: FaMicrophone, label: "Call Analysis", value: "AI-Powered" },
  { icon: FaBrain, label: "Languages", value: "101+" },
  { icon: FaRobot, label: "AI Assistant", value: "Reva" },
  { icon: FaShieldAlt, label: "Security", value: "Enterprise" },
];

const KEY_FEATURES = [
  { icon: FaTachometerAlt, title: "Interactive Dashboard", desc: "Real-time metrics, call volume trends, agent performance charts, and sentiment distribution at a glance." },
  { icon: FaCloudUploadAlt, title: "Call Upload & Processing", desc: "Upload audio files with agent metadata. Automated transcription, diarization, and AI analysis pipeline." },
  { icon: FaChartLine, title: "Reports & Analytics", desc: "Detailed call reports with filtering, score breakdowns, sentiment trends, and exportable data." },
  { icon: FaCheckDouble, title: "AI Scoring & QA", desc: "Automated quality scoring with tone analysis, script compliance checks, and AI vs manual score comparison." },
  { icon: FaUsers, title: "Agent Management", desc: "Manage agent profiles, track individual performance, assign teams, and monitor coaching needs." },
  { icon: FaShieldAlt, title: "Role-Based Access (RBAC)", desc: "Granular permissions for admins, supervisors, team leaders, and agents with secure session management." },
  { icon: FaKey, title: "License Management", desc: "License activation, validation, and expiration tracking with admin-level controls." },
  { icon: FaCog, title: "Admin Settings", desc: "System configuration, application branding, maintenance mode, theme settings, and monitoring tools." },
  { icon: FaFileAlt, title: "System Monitoring", desc: "Health checks, API status, server metrics, disk usage, and system logs for operational visibility." },
  { icon: FaHeadset, title: "Supervisor Tools", desc: "Team-leader filters, agent comparison views, and supervisor-specific dashboards for oversight." },
];

const TECH_STACK = [
  { icon: FaReact, name: "React", detail: "Modern component-based frontend with hooks and context" },
  { icon: FaNodeJs, name: "Node.js", detail: "RESTful backend API with Express.js" },
  { icon: FaDatabase, name: "SQL Server", detail: "Enterprise-grade relational database for call data" },
  { icon: FaBrain, name: "AI / ML", detail: "Speech-to-text, NLP, sentiment analysis, and scoring models" },
  { icon: FaServer, name: "REST API", detail: "Structured endpoints for all platform operations" },
  { icon: FaShieldAlt, name: "Security", detail: "JWT authentication, RBAC, encrypted transport, audit logs" },
];

const PIPELINE = [
  { step: "01", label: "Upload", desc: "Audio files with agent & call metadata" },
  { step: "02", label: "Transcribe", desc: "ASR + speaker diarization (101 languages)" },
  { step: "03", label: "Analyze", desc: "Tone, sentiment, scoring, compliance" },
  { step: "04", label: "Report", desc: "Dashboards, exports, supervisor review" },
];

const About = () => {
  const signature = "$Panja";
  if (signature !== "$Panja") throw new Error("Signature mismatch");

  const navigate = useNavigate();
  const { appName } = useAppBranding();
  const footerText = getAppFooter(appName);
  const [lineIdx, setLineIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setLineIdx((i) => (i + 1) % ROTATING_LINES.length);
        setVisible(true);
      }, 350);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="about-page app-page reports-page app-stagger">
      <div className="about-page__mesh" aria-hidden="true">
        <span className="about-orb about-orb--1" />
        <span className="about-orb about-orb--2" />
        <span className="about-orb about-orb--3" />
      </div>

      {/* ── Hero ── */}
      <section className="about-hero about-animate-in">
        <div className="about-hero__inner">
          <Badge variant="accent">Production · {APP_VERSION}</Badge>
          <h1 className="about-hero__headline">
            Turn every conversation into measurable performance
          </h1>
          <p className={`about-hero__rotate ${visible ? "is-visible" : "is-hidden"}`}>
            {ROTATING_LINES[lineIdx]}
          </p>
          <p className="about-hero__desc">
            <strong>{appName}</strong> is an enterprise-grade platform that transforms raw call
            recordings into actionable insights. Powered by advanced AI, it delivers automated
            transcription, sentiment analysis, quality scoring, and supervisor tools — all within
            a secure, role-aware workspace built for contact centers.
          </p>
          <div className="about-hero__actions">
            <Button variant="primary" onClick={() => navigate("/upload")}>
              <FaCloudUploadAlt /> Start Analyzing
            </Button>
            <Button variant="secondary" onClick={() => navigate("/reports/details")}>
              <FaChartLine /> View Reports
            </Button>
          </div>
        </div>
      </section>

      {/* ── Quick stats ── */}
      <div className="ui-stat-grid about-stats about-animate-in about-animate-in--delay-1">
        {STATS.map((s) => (
          <Card key={s.label} className="about-stat-card">
            <s.icon className="about-stat-card__icon" aria-hidden="true" />
            <div className="about-stat-card__value">{s.value}</div>
            <div className="about-stat-card__label">{s.label}</div>
          </Card>
        ))}
      </div>

      {/* ── About the Platform ── */}
      <PageSection title="About the Platform" className="about-animate-in about-animate-in--delay-2">
        <Card className="about-platform-card">
          <div className="about-platform-content">
            <p>
              <strong>{appName}</strong> is designed to help contact centers and quality assurance
              teams monitor, evaluate, and improve agent performance through AI-powered call analysis.
              The platform processes call recordings through an automated pipeline — from upload to
              transcription, analysis, and reporting.
            </p>
            <p>
              Supervisors and managers gain access to real-time dashboards, detailed call breakdowns,
              sentiment trends, and compliance metrics. The system supports multilingual transcription
              across 101+ languages, AI-based quality scoring, and an integrated AI assistant (Reva)
              for guided insights.
            </p>
            <p>
              With role-based access control, license management, and comprehensive admin settings,
              the platform is built for secure, scalable deployment in enterprise environments.
            </p>
          </div>
        </Card>
      </PageSection>

      {/* ── Key Features ── */}
      <PageSection title="Key Features" className="about-animate-in about-animate-in--delay-3">
        <div className="about-feature-grid about-feature-grid--full">
          {KEY_FEATURES.map((f) => (
            <Card key={f.title} className="about-feature-card">
              <f.icon className="about-feature-card__icon" aria-hidden="true" />
              <h3 className="about-feature-card__title">{f.title}</h3>
              <p className="about-feature-card__text">{f.desc}</p>
            </Card>
          ))}
        </div>
      </PageSection>

      {/* ── Analysis Pipeline ── */}
      <PageSection title="Analysis Pipeline" className="about-animate-in about-animate-in--delay-4">
        <div className="about-pipeline">
          {PIPELINE.map((p, i) => (
            <div key={p.step} className="about-pipeline__step" style={{ animationDelay: `${i * 0.08}s` }}>
              <span className="about-pipeline__num">{p.step}</span>
              <strong>{p.label}</strong>
              <span>{p.desc}</span>
            </div>
          ))}
        </div>
      </PageSection>

      {/* ── Tech Stack ── */}
      <PageSection title="Technology Stack" className="about-animate-in about-animate-in--delay-5">
        <div className="about-tech-grid">
          {TECH_STACK.map((t) => (
            <Card key={t.name} className="about-tech-card">
              <t.icon className="about-tech-card__icon" aria-hidden="true" />
              <div className="about-tech-card__info">
                <strong className="about-tech-card__name">{t.name}</strong>
                <span className="about-tech-card__detail">{t.detail}</span>
              </div>
            </Card>
          ))}
        </div>
      </PageSection>

      {/* ── Contact & Footer ── */}
      <PageSection title="Contact & Support" className="about-animate-in about-animate-in--delay-5">
        <div className="about-cta">
          <p>
            Have questions about the platform, deployment, licensing, or custom features?
            Feel free to reach out.
          </p>
          <div className="about-cta__actions">
            <Button
              variant="primary"
              onClick={() => (window.location.href = "mailto:support@aipoweredcallanalysis.com")}
            >
              <FaEnvelope /> Get in Touch
            </Button>
          </div>
          <p className="about-footer-note">{footerText}</p>
        </div>
      </PageSection>
    </div>
  );
};

export default About;
